import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { once } from 'node:events'
import { chmod, mkdtemp, realpath, rm } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TextDecoder } from 'node:util'
import { parseStatusRequest, type StatusEvent, type StatusReply } from './status-protocol'
import { StatusState } from './status-state'

const maxFrameBytes = 16 * 1024
const maxConnections = 64
const maxFrames = 32
const requestDeadlineMs = 2_000
const maxLaunches = 64
const maxRequestsPerSecond = 128

type Placement = { terminalId: string; cwd: string }
type Launch = {
  placement: Placement
  token: Buffer | undefined
  status: StatusState
  rate: { second: number; count: number }
}
type Change =
  | { launchId: string; kind: 'registered' | 'exited' | 'revoked' }
  | { launchId: string; kind: 'event'; event: StatusEvent }
type Listener = (change: Change) => void
type Endpoint = { server: Server; directory: string; path: string }

export class AgentStatusServer {
  #transition: Promise<unknown> = Promise.resolve()
  #endpoint: Endpoint | undefined
  #clients = new Set<Socket>()
  #launches = new Map<string, Launch>()
  #listeners = new Set<Listener>()

  start(parent = process.platform === 'darwin' ? '/tmp' : tmpdir()): Promise<string | undefined> {
    const start = this.#transition.then(async () => {
      if (process.platform === 'win32') return undefined
      if (this.#endpoint) return this.#endpoint.path
      const directory = await mkdtemp(join(await realpath(parent), 'h360-'))
      const path = join(directory, 'status')
      const server = createServer((socket) => this.#connect(socket))
      server.maxConnections = maxConnections
      try {
        if (Buffer.byteLength(path) > 103)
          throw new Error('Agent status socket path exceeds 103 bytes')
        await chmod(directory, 0o700)
        const listening = once(server, 'listening')
        server.listen(path)
        await listening
        server.on('error', (error) => {
          console.error('Agent status listener failed:', error)
          void this.stop().catch((failure: unknown) =>
            console.error('Agent status cleanup failed:', failure)
          )
        })
        await chmod(path, 0o600)
        this.#endpoint = { server, directory, path }
        return path
      } catch (error) {
        await this.#close(server, directory)
        throw error
      }
    })
    this.#transition = start.catch(() => undefined)
    return start
  }

  stop(): Promise<void> {
    const stop = this.#transition.then(async () => {
      const endpoint = this.#endpoint
      this.#endpoint = undefined
      for (const id of this.#launches.keys()) this.revokeLaunch(id)
      if (endpoint) await this.#close(endpoint.server, endpoint.directory)
    })
    this.#transition = stop.catch(() => undefined)
    return stop
  }

  registerLaunch(placement: Placement) {
    if (!this.#endpoint) throw new Error('Agent status server not available')
    if (this.#launches.size >= maxLaunches) throw new Error('Agent status launch limit reached')
    const launchId = randomUUID()
    const token = randomBytes(32).toString('hex')
    this.#launches.set(launchId, {
      placement: { ...placement },
      token: Buffer.from(token),
      status: new StatusState(),
      rate: { second: 0, count: 0 }
    })
    const endpoint = this.#endpoint.path
    this.#emit({ launchId, kind: 'registered' })
    return { launchId, token, endpoint }
  }

  revokeLaunch(launchId: string): void {
    if (this.#launches.delete(launchId)) this.#emit({ launchId, kind: 'revoked' })
  }

  markExited(launchId: string): void {
    const launch = this.#launches.get(launchId)
    if (!launch?.token) return
    launch.token = undefined
    this.#emit({ launchId, kind: 'exited' })
  }

  snapshot() {
    return Array.from(this.#launches, ([launchId, launch]) => ({
      launchId,
      ...launch.placement,
      process: launch.token ? ('active' as const) : ('exited' as const),
      session: launch.status.snapshot()
    }))
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  #emit(change: Change): void {
    for (const listener of Array.from(this.#listeners)) {
      try {
        listener(structuredClone(change))
      } catch (error) {
        console.error('Agent status subscriber failed:', error)
      }
    }
  }

  async #close(server: Server, directory: string): Promise<void> {
    for (const client of this.#clients) client.destroy()
    try {
      if (server.listening) {
        const closed = once(server, 'close')
        server.close()
        await closed
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }

  #connect(socket: Socket): void {
    this.#clients.add(socket)
    const deadline = setTimeout(() => socket.destroy(), requestDeadlineMs)
    socket.on('error', () => socket.destroy())
    socket.on('close', () => {
      clearTimeout(deadline)
      this.#clients.delete(socket)
    })
    const frame = Buffer.alloc(maxFrameBytes)
    let used = 0
    let frames = 0
    let closed = false
    socket.on('data', (chunk: Buffer) => {
      let start = 0
      while (start < chunk.length && !closed) {
        const newline = chunk.indexOf(10, start)
        const end = newline === -1 ? chunk.length : newline
        if (used + end - start > maxFrameBytes || frames >= maxFrames) {
          closed = true
          socket.end('{"ok":false,"error":"limit"}\n')
          return
        }
        used += chunk.copy(frame, used, start, end)
        if (newline === -1) break
        const reply = this.#receive(frame.subarray(0, used))
        socket.write(`${JSON.stringify(reply)}\n`)
        used = 0
        frames += 1
        start = newline + 1
      }
    })
  }

  #receive(frame: Buffer): StatusReply {
    let input: unknown
    try {
      input = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(frame))
    } catch {
      return { ok: false, error: 'invalid' }
    }
    const request = parseStatusRequest(input)
    if (typeof request === 'string') return { ok: false, error: request }
    const { token, ...event } = request
    const launch = this.#launches.get(event.launchId)
    const credential = Buffer.from(token)
    if (
      !launch?.token ||
      credential.length !== launch.token.length ||
      !timingSafeEqual(credential, launch.token)
    )
      return { ok: false, error: 'unauthorized' }
    const second = Math.floor(performance.now() / 1000)
    if (launch.rate.second !== second) launch.rate = { second, count: 0 }
    if (launch.rate.count >= maxRequestsPerSecond) return { ok: false, error: 'limit' }
    launch.rate.count += 1
    const fields = Object.entries(event).toSorted(([a], [b]) => a.localeCompare(b))
    const digest = createHash('sha256').update(JSON.stringify(fields)).digest('hex')
    const reply = launch.status.accept(event, digest)
    if (reply.ok && reply.status === 'accepted')
      this.#emit({ launchId: event.launchId, kind: 'event', event })
    return reply
  }
}

export const agentStatusServer = new AgentStatusServer()
