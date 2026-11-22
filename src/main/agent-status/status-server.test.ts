import { once } from 'node:events'
import { stat } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { dirname } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentStatusServer } from './status-server'

async function exchange(path: string, chunks: (string | Buffer)[]): Promise<unknown[]> {
  const client = createConnection(path)
  try {
    await once(client, 'connect')
    const response = (async () => {
      let output = ''
      for await (const data of client.setEncoding('utf8')) output += String(data)
      return output
        .trim()
        .split('\n')
        .map((line): unknown => JSON.parse(line))
    })()
    for (const chunk of chunks) {
      await new Promise<void>((resolve, reject) => {
        client.write(chunk, (error) => (error ? reject(error) : resolve()))
      })
    }
    client.end()
    return await response
  } finally {
    client.destroy()
  }
}

const accepted = { ok: true, status: 'accepted' }
const main = { actorId: 'main', actorStart: 1 }
const turn = { ...main, turnId: 'one', turnStart: 2 }

function session(server: AgentStatusServer) {
  const { launchId, token, endpoint } = server.registerLaunch({
    terminalId: 'terminal',
    cwd: '/project'
  })
  const event = (sequence: number, fields: Record<string, unknown>) => ({
    version: 1,
    launchId,
    token,
    sessionId: 'provider-session',
    sessionEpoch: 1,
    sequence,
    eventId: `event-${sequence}`,
    ...fields
  })
  const start = {
    kind: 'session.started',
    provider: 'agent',
    capabilities: ['waits', 'actors', 'notifications', 'session-end']
  }
  const send = (...events: Record<string, unknown>[]) =>
    exchange(endpoint, [events.map((entry) => JSON.stringify(entry)).join('\n') + '\n'])
  return { launchId, endpoint, event, start, send }
}

describe.skipIf(process.platform === 'win32')('agent status socket', () => {
  const server = new AgentStatusServer()
  afterEach(async () => server.stop())

  it('correlates script jobs across parent completion and rejects old or unsupported reports', async () => {
    await server.start()
    const { event, start, send, launchId } = session(server)
    const job = { kind: 'script.started', scriptId: 'bash-job' }
    const finish = { kind: 'script.ended', scriptId: 'bash-job', scriptStart: 3 }
    expect(await send(event(1, start), event(2, job))).toEqual([
      accepted,
      { ok: false, error: 'state' }
    ])
    const epoch = (n: number, fields: Record<string, unknown>) =>
      event(n, { sessionEpoch: 2, ...fields })
    expect(
      await send(
        epoch(2, { ...start, capabilities: ['scripts', 'session-end'] }),
        epoch(3, job),
        epoch(4, { kind: 'turn.started', actorId: 'main', actorStart: 2, turnId: 'parent' }),
        epoch(5, {
          kind: 'turn.ended',
          actorId: 'main',
          actorStart: 2,
          turnId: 'parent',
          turnStart: 4,
          outcome: 'completed'
        })
      )
    ).toEqual([accepted, accepted, accepted, accepted])
    expect(server.snapshot()[0]?.session?.scripts.get('bash-job')).toBe(3)
    expect(await send(epoch(3, job), epoch(6, finish), epoch(7, job), epoch(8, finish))).toEqual([
      { ok: true, status: 'duplicate' },
      accepted,
      accepted,
      { ok: false, error: 'state' }
    ])
    expect(server.snapshot()[0]?.session?.scripts.get('bash-job')).toBe(7)
    expect(await send(epoch(8, { kind: 'session.ended' }))).toEqual([accepted])
    expect(server.snapshot()[0]?.session?.scripts.size).toBe(0)
    server.markExited(launchId)
    expect(await send(epoch(9, job))).toEqual([{ ok: false, error: 'unauthorized' }])
  })

  it('starts once with private permissions and closes clients and the owned directory at shutdown', async () => {
    const [path, again] = await Promise.all([server.start(), server.start()])
    if (!path) throw new Error('Expected Unix socket')
    expect(again).toBe(path)
    expect((await stat(dirname(path))).mode & 0o777).toBe(0o700)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    const client = createConnection(path)
    try {
      await once(client, 'connect')
      const closed = once(client, 'close')
      await Promise.all([server.stop(), server.stop(), closed])
      await expect(stat(dirname(path))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      client.destroy()
    }
  })

  it('validates and frames actual UTF-8 socket traffic and rejects unauthorized and oversized requests', async () => {
    await server.start()
    const { event, endpoint, start, send } = session(server)
    const registration = JSON.stringify(event(1, start))
    expect(
      await exchange(endpoint, [
        registration.slice(0, 20),
        registration.slice(20) + '\n{bad}\n',
        Buffer.from([0xff, 10])
      ])
    ).toEqual([accepted, { ok: false, error: 'invalid' }, { ok: false, error: 'invalid' }])
    expect(
      await send(
        event(2, { ...start, version: 2 }),
        event(2, { ...start, token: 'wrong' }),
        event(2, { ...start, cwd: '/forged' })
      )
    ).toEqual([
      { ok: false, error: 'version' },
      { ok: false, error: 'unauthorized' },
      { ok: false, error: 'invalid' }
    ])
    expect(await exchange(endpoint, ['x'.repeat(16_385)])).toEqual([{ ok: false, error: 'limit' }])
  })

  it('handles duplicates, gaps and old generations without repeating notifications or resetting on reconnect', async () => {
    await server.start()
    const { event, start, send } = session(server)
    const notices: string[] = []
    const unsubscribe = server.subscribe((change) => {
      if (change.kind === 'event' && change.event.kind === 'notification')
        notices.push(change.event.title)
    })
    try {
      const notification = event(4, { kind: 'notification', title: 'Extra', body: 'Text' })
      expect(
        await send(
          event(1, start),
          event(2, { kind: 'turn.started', ...main, turnId: 'one' }),
          notification
        )
      ).toEqual([accepted, accepted, accepted])
      expect(
        await send(
          notification,
          { ...notification, title: 'Changed' },
          event(3, { kind: 'activity.changed', ...turn, activity: 'idle' }),
          event(5, start)
        )
      ).toEqual([
        { ok: true, status: 'duplicate' },
        { ok: false, error: 'conflict' },
        { ok: true, status: 'stale' },
        accepted
      ])
      expect(notices).toEqual(['Extra'])
      expect(server.snapshot()[0]?.session?.actors.get('main')?.turn).toMatchObject({
        id: 'one',
        activity: 'working'
      })
      expect(
        await send(
          event(6, { ...start, sessionEpoch: 6 }),
          event(7, { kind: 'turn.ended', ...turn, outcome: 'completed' })
        )
      ).toEqual([accepted, { ok: false, error: 'state' }])
      expect(server.snapshot()[0]?.session?.actors.get('main')?.turn).toBeUndefined()
    } finally {
      unsubscribe()
    }
  })

  it('scopes wait resolution, preserves child work across main turns, and retires exited launch credentials', async () => {
    await server.start()
    const { launchId, event, start, send } = session(server)
    const child = { actorId: 'child', actorStart: 3 }
    const childTurn = { ...child, turnId: 'child-turn', turnStart: 4 }
    expect(
      await send(
        event(1, start),
        event(2, { kind: 'turn.started', ...main, turnId: 'one' }),
        event(3, { kind: 'actor.started', actorId: 'child', parentId: 'main', parentStart: 1 }),
        event(4, { kind: 'turn.started', ...child, turnId: 'child-turn' }),
        event(5, { kind: 'wait.started', ...childTurn, waitId: 'approval', reason: 'permission' }),
        event(6, { kind: 'turn.ended', ...turn, outcome: 'completed' }),
        event(7, { kind: 'turn.started', ...main, turnId: 'next' }),
        event(8, { kind: 'wait.resolved', ...childTurn, waitId: 'approval', waitStart: 4 })
      )
    ).toEqual([
      accepted,
      accepted,
      accepted,
      accepted,
      accepted,
      accepted,
      accepted,
      { ok: false, error: 'state' }
    ])
    expect(server.snapshot()[0]).toMatchObject({
      terminalId: 'terminal',
      cwd: '/project',
      process: 'active'
    })
    expect(server.snapshot()[0]?.session?.actors.get('child')?.turn?.waits.get('approval')).toEqual(
      { reason: 'permission', start: 5 }
    )
    expect(
      await send(
        event(9, { kind: 'wait.resolved', ...childTurn, waitId: 'approval', waitStart: 5 })
      )
    ).toEqual([accepted])
    expect(server.snapshot()[0]?.session?.actors.get('child')?.turn?.waits.size).toBe(0)
    server.markExited(launchId)
    expect(server.snapshot()[0]?.process).toBe('exited')
    expect(await send(event(10, { kind: 'session.ended' }))).toEqual([
      { ok: false, error: 'unauthorized' }
    ])
    server.revokeLaunch(launchId)
    expect(server.snapshot()).toEqual([])
  })
})
