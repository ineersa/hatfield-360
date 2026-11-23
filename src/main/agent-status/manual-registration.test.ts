import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { readFile, stat } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { spawn } from 'node-pty'
import { expect, it } from 'vitest'
import { AgentStatusServer } from './status-server'

async function register(endpoint: string, request: object) {
  const socket = createConnection(endpoint)
  try {
    await once(socket, 'connect')
    socket.end(`${JSON.stringify(request)}\n`)
    let output = ''
    for await (const chunk of socket.setEncoding('utf8')) output += String(chunk)
    return JSON.parse(output) as unknown
  } finally {
    socket.destroy()
  }
}

it.skipIf(process.platform !== 'linux')(
  'binds registrations to live PTY owners and retires them without shell exit',
  async () => {
    const server = new AgentStatusServer()
    const shell = spawn('/bin/bash', ['--noprofile', '--norc'], { cwd: '/tmp' })
    const other = spawn('/bin/bash', ['--noprofile', '--norc'], { cwd: '/tmp' })
    const children = new Set<number>()
    try {
      const bootstrap = await server.prepareBootstrap({ terminalId: 'owned-pane', cwd: '/' })
      if (!bootstrap) throw new Error('Missing bootstrap')
      await server.bindBootstrap(bootstrap.token, shell.pid)
      async function owner(pty: typeof shell) {
        const pid = await new Promise<number>((resolve) => {
          let text = ''
          const listener = pty.onData((chunk) => {
            text += chunk
            const match = /OWNER=(\d+)/.exec(text)
            if (!match?.[1]) return
            listener.dispose()
            resolve(Number(match[1]))
          })
          pty.write("sleep 30 & printf 'OWNER=%s\\n' $!\r")
        })
        children.add(pid)
        const text = await readFile(`/proc/${pid}/stat`, 'utf8')
        const namespace = await stat(`/proc/${pid}/ns/pid`, { bigint: true })
        return {
          pid,
          pidNamespace: namespace.ino.toString(),
          startTicks: text.slice(text.lastIndexOf(') ') + 2).split(' ')[19]
        }
      }
      const first = await owner(shell)
      const foreign = await owner(other)
      const request = {
        version: 1,
        kind: 'launch.register',
        bootstrapToken: bootstrap.token,
        instanceId: randomUUID(),
        provider: 'hatfield',
        owner: first
      }
      const send = (value: object) => register(bootstrap.endpoint, value)
      expect(await send({ ...request, bootstrapToken: 'a'.repeat(64) })).toEqual({
        ok: false,
        error: 'unauthorized'
      })
      expect(await send({ ...request, owner: foreign })).toEqual({
        ok: false,
        error: 'unavailable'
      })
      const result = await send(request)
      if (typeof result !== 'object' || result === null || !('launchId' in result))
        throw new Error('Missing registration')
      expect(result).toMatchObject({ ok: true })
      expect(await send(request)).toEqual(result)
      expect(await send({ ...request, instanceId: randomUUID() })).toEqual({
        ok: false,
        error: 'conflict'
      })
      expect(await send(request)).toEqual({ ok: false, error: 'limit' })
      expect(server.snapshot()).toEqual([
        {
          launchId: result.launchId,
          terminalId: 'owned-pane',
          cwd: '/tmp',
          process: 'active',
          session: undefined
        }
      ])
      process.kill(first.pid, 'SIGKILL')
      children.delete(first.pid)
      await expect.poll(() => server.snapshot(), { timeout: 3000 }).toEqual([])
      const second = await owner(shell)
      const next = await send({ ...request, owner: second, instanceId: randomUUID() })
      expect(next).toMatchObject({ ok: true })
      expect(next).not.toEqual(result)
      const nested = await owner(shell)
      expect(await send({ ...request, owner: nested, instanceId: randomUUID() })).toMatchObject({
        ok: true
      })
      expect(server.snapshot()).toHaveLength(2)
      server.closeBootstrap(bootstrap.token)
      expect(server.snapshot()).toEqual([])
    } finally {
      for (const pid of children) process.kill(pid, 'SIGKILL')
      shell.kill()
      other.kill()
      await server.stop()
    }
  },
  10_000
)
