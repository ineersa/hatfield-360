import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { once } from 'node:events'
import { chmod, mkdtemp, realpath, rm } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TextDecoder } from 'node:util'
import {
  parseRegistration,
  parseStatusRequest,
  type Registration,
  type StatusEvent,
  type StatusReply
} from './status-protocol'
import { findOwner, observeProcess, pinProcess, type PinnedProcess } from './linux-process-identity'
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
  provider?: Registration['provider']
  token: Buffer | undefined
  status: StatusState
  rate: { second: number; count: number }
}
type Credential = { launchId: string; token: string; endpoint: string }
type ManualOwner = {
  identity: string
  credential: Credential
  process: PinnedProcess
  timer?: NodeJS.Timeout
  errors: number
  retired: boolean
}
type Bootstrap = {
  placement: Placement
  root?: PinnedProcess
  lookup?: AbortController
  owners: Map<string, ManualOwner>
  attempts: number[]
}
type RegistrationReply = StatusReply | { ok: true; launchId: string; token: string }
type Change =
  | { launchId: string; kind: 'registered' | 'exited' | 'revoked' }
  | { launchId: string; kind: 'event'; event: StatusEvent }
  | {
      launchId: string
      kind: 'manual-registered'
      terminalId: string
      provider: Registration['provider']
      cwd: string | null
    }
  | { launchId: string; kind: 'manual-ended'; exited: boolean }
type Listener = (change: Change) => void
type Endpoint = { server: Server; directory: string; path: string }

export class AgentStatusServer {
  #transition: Promise<unknown> = Promise.resolve()
  #endpoint: Endpoint | undefined
  #clients = new Set<Socket>()
  #launches = new Map<string, Launch>()
  #bootstraps = new Map<string, Bootstrap>()
  #listeners = new Set<Listener>()

  start(
    parent = process.platform === 'darwin' || process.platform === 'linux' ? '/tmp' : tmpdir()
  ): Promise<string | undefined> {
    const start = this.#transition.then(async () => {
      if (process.platform === 'win32') return undefined
      if (this.#endpoint) return this.#endpoint.path
      const directory = await mkdtemp(join(await realpath(parent), 'h360-'))
      const path = join(directory, 'status')
      const server = createServer({ allowHalfOpen: true }, (socket) => this.#connect(socket))
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
      for (const token of this.#bootstraps.keys()) this.closeBootstrap(token)
      for (const id of this.#launches.keys()) this.revokeLaunch(id)
      if (endpoint) await this.#close(endpoint.server, endpoint.directory)
    })
    this.#transition = stop.catch(() => undefined)
    return stop
  }

  async prepareBootstrap(placement: Placement) {
    if (process.platform !== 'linux') return undefined
    const endpoint = await this.start()
    if (!endpoint || this.#bootstraps.size >= maxLaunches) return undefined
    const token = randomBytes(32).toString('hex')
    this.#bootstraps.set(token, { placement, owners: new Map(), attempts: [] })
    return { endpoint, token }
  }

  async bindBootstrap(token: string, pid: number) {
    const bootstrap = this.#bootstraps.get(token)
    if (!bootstrap) return
    const root = await pinProcess(pid)
    if (root.tty !== '0' && this.#bootstraps.get(token) === bootstrap) bootstrap.root = root
    else await root.handle.close()
  }

  closeBootstrap(token: string) {
    const bootstrap = this.#bootstraps.get(token)
    if (!bootstrap) return
    this.#bootstraps.delete(token)
    bootstrap.lookup?.abort()
    void bootstrap.root?.handle.close().catch(() => undefined)
    for (const owner of bootstrap.owners.values()) this.#retireManual(owner, false)
    bootstrap.owners.clear()
  }

  #retireManual(owner: ManualOwner, exited: boolean) {
    if (owner.retired) return
    owner.retired = true
    clearTimeout(owner.timer)
    void owner.process.handle.close().catch(() => undefined)
    this.revokeLaunch(owner.credential.launchId)
    this.#emit({ launchId: owner.credential.launchId, kind: 'manual-ended', exited })
  }

  #watchManual(bootstrap: Bootstrap, instanceId: string, owner: ManualOwner) {
    owner.timer = setTimeout(() => {
      void this.#pollManual(bootstrap, instanceId, owner)
    }, 1000).unref()
  }

  async #pollManual(bootstrap: Bootstrap, instanceId: string, owner: ManualOwner) {
    let exited: boolean
    try {
      exited = !(await observeProcess(owner.process.handle)).alive
      owner.errors = 0
    } catch (error) {
      exited = error instanceof Error && 'code' in error && error.code === 'ESRCH'
      if (!exited) owner.errors++
    }
    if (owner.retired) return
    if (exited) {
      bootstrap.owners.delete(instanceId)
      this.#retireManual(owner, true)
    } else if (owner.errors >= 3) this.#retireManual(owner, false)
    else this.#watchManual(bootstrap, instanceId, owner)
  }

  async #registerManual(request: Registration, signal: AbortSignal): Promise<RegistrationReply> {
    const bootstrap = this.#bootstraps.get(request.token)
    if (!bootstrap) return { ok: false, error: 'unauthorized' }
    const now = performance.now()
    bootstrap.attempts = bootstrap.attempts.filter((time) => now - time < 1000)
    if (bootstrap.attempts.length >= 4) return { ok: false, error: 'limit' }
    bootstrap.attempts.push(now)
    if (!bootstrap.root) return { ok: false, error: 'unavailable' }
    if (bootstrap.lookup) return { ok: false, error: 'limit' }
    const controller = new AbortController()
    bootstrap.lookup = controller
    const lookup = AbortSignal.any([signal, controller.signal])
    const identity = JSON.stringify(request.owner)
    try {
      const prior = bootstrap.owners.get(request.instanceId)
      if (prior && prior.identity !== identity) return { ok: false, error: 'conflict' }
      if (prior?.retired) return { ok: false, error: 'unavailable' }
      if (
        [...bootstrap.owners.values()].some(
          (owner) => owner !== prior && owner.identity === identity
        )
      )
        return { ok: false, error: 'conflict' }
      if (prior) {
        if (this.#launches.get(prior.credential.launchId)?.provider !== request.provider)
          return { ok: false, error: 'conflict' }
        if (!(await observeProcess(prior.process.handle)).alive || lookup.aborted)
          return { ok: false, error: 'unavailable' }
        return { ok: true, launchId: prior.credential.launchId, token: prior.credential.token }
      }
      if (bootstrap.owners.size >= 4 || this.#launches.size >= maxLaunches)
        return { ok: false, error: 'limit' }
      const process = await findOwner(bootstrap.root, request.owner, lookup)
      if (!process) return { ok: false, error: 'unavailable' }
      let keep = false
      try {
        if (lookup.aborted || this.#bootstraps.get(request.token) !== bootstrap)
          return { ok: false, error: 'unavailable' }
        if (this.#launches.size >= maxLaunches) return { ok: false, error: 'limit' }
        const credential = this.registerLaunch(
          { ...bootstrap.placement, cwd: process.cwd ?? bootstrap.placement.cwd },
          request.provider
        )
        const owner = { identity, credential, process, errors: 0, retired: false }
        bootstrap.owners.set(request.instanceId, owner)
        keep = true
        this.#watchManual(bootstrap, request.instanceId, owner)
        this.#emit({
          launchId: credential.launchId,
          kind: 'manual-registered',
          terminalId: bootstrap.placement.terminalId,
          provider: request.provider,
          cwd: process.cwd
        })
        return { ok: true, launchId: credential.launchId, token: credential.token }
      } finally {
        if (!keep) await process.handle.close()
      }
    } catch {
      return { ok: false, error: 'unavailable' }
    } finally {
      delete bootstrap.lookup
    }
  }

  registerLaunch(placement: Placement, provider?: Registration['provider']) {
    if (!this.#endpoint) throw new Error('Agent status server not available')
    if (this.#launches.size >= maxLaunches) throw new Error('Agent status launch limit reached')
    const launchId = randomUUID()
    const token = randomBytes(32).toString('hex')
    this.#launches.set(launchId, {
      placement: { ...placement },
      ...(provider ? { provider } : {}),
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
    const pending = new AbortController()
    const deadline = setTimeout(() => {
      pending.abort()
      socket.destroy()
    }, requestDeadlineMs)
    socket.on('error', () => socket.destroy())
    socket.on('close', () => {
      pending.abort()
      clearTimeout(deadline)
      this.#clients.delete(socket)
    })
    const frame = Buffer.alloc(maxFrameBytes)
    let used = 0
    let frames = 0
    let closed = false
    socket.on('end', () => {
      if (!closed) socket.end()
    })
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
        const reply = this.#receive(frame.subarray(0, used), pending.signal)
        if (reply instanceof Promise) {
          closed = true
          void reply.then((result) => {
            if (!socket.destroyed) socket.end(`${JSON.stringify(result)}\n`)
          })
          return
        }
        socket.write(`${JSON.stringify(reply)}\n`)
        used = 0
        frames += 1
        start = newline + 1
      }
    })
  }

  #receive(frame: Buffer, signal: AbortSignal): RegistrationReply | Promise<RegistrationReply> {
    let input: unknown
    try {
      input = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(frame))
    } catch {
      return { ok: false, error: 'invalid' }
    }
    if (
      typeof input === 'object' &&
      input !== null &&
      !Array.isArray(input) &&
      'kind' in input &&
      input.kind === 'launch.register'
    ) {
      if (!('version' in input) || input.version !== 1) return { ok: false, error: 'version' }
      const registration = parseRegistration(input)
      return registration
        ? this.#registerManual(registration, signal)
        : { ok: false, error: 'invalid' }
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
    if (launch.provider && event.kind === 'session.started' && event.provider !== launch.provider)
      return { ok: false, error: 'state' }
    const reply = launch.status.accept(event, digest)
    if (reply.ok && reply.status === 'accepted')
      this.#emit({ launchId: event.launchId, kind: 'event', event })
    return reply
  }
}

export const agentStatusServer = new AgentStatusServer()
