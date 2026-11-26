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
    kind: 'session.snapshot',
    provider: 'hatfield',
    turn: { id: 'turn', status: 'working' },
    attention: null,
    activeSubagents: null,
    backgroundScripts: 0,
    tool: null
  }
  const send = (...events: Record<string, unknown>[]) =>
    exchange(endpoint, [events.map((entry) => JSON.stringify(entry)).join('\n') + '\n'])
  return { launchId, endpoint, event, start, send }
}

describe.skipIf(process.platform === 'win32')('agent status socket', () => {
  const server = new AgentStatusServer()
  afterEach(async () => server.stop())

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

  it('validates exact snapshot shapes and bounds over the socket', async () => {
    await server.start()
    const { event, start, send } = session(server)
    const invalid = [
      { sessionEpoch: 5 },
      { sequence: Number.MAX_SAFE_INTEGER + 1 },
      { provider: 'other' },
      { capabilities: [] },
      { tool: undefined },
      { turn: { id: 'a'.repeat(129), status: 'working' } },
      { turn: { id: 'turn', status: 'working', actorId: 'main' } },
      { attention: { id: 'wait', reason: 'question', extra: true } },
      { attention: { id: 'wait', reason: 'other' } },
      { activeSubagents: -1 },
      { backgroundScripts: 1025 },
      { backgroundScripts: 0.5 },
      { tool: 'x'.repeat(129) },
      { kind: 'session.started' }
    ]
    expect(await send(...invalid.map((fields) => event(4, { ...start, ...fields })))).toEqual(
      invalid.map(() => ({ ok: false, error: 'invalid' }))
    )
    expect(
      await send(event(4, { ...start, activeSubagents: 1024, backgroundScripts: null }))
    ).toEqual([accepted])
  })

  it('validates schedules, turn triggers and responses, and replaces schedules with each snapshot', async () => {
    await server.start()
    const { event, start, send } = session(server)
    const loop = {
      id: 'loop',
      label: 'Every 5 minutes',
      recurring: true,
      nextRunAt: 1_700_000_000_000
    }
    const invalid = [
      { schedules: {} },
      { schedules: [{ ...loop, prompt: '/loop 5m check' }] },
      { schedules: [{ ...loop, label: 'x'.repeat(65) }] },
      { schedules: [{ ...loop, nextRunAt: -1 }] },
      { schedules: [{ ...loop, nextRunAt: 1.5 }] },
      { schedules: [{ ...loop, recurring: 'yes' }] },
      { schedules: [loop, loop] },
      { schedules: Array.from({ length: 17 }, (_, index) => ({ ...loop, id: `job-${index}` })) },
      { turn: { id: 'turn', status: 'working', trigger: 'cron' } },
      { turn: { id: 'turn', status: 'completed', response: 'x'.repeat(2001) } },
      { turn: { id: 'turn', status: 'completed', response: 42 } },
      { turn: { id: 'turn', status: 'working', response: 'Not yet' } },
      { turn: { id: 'turn', status: 'failed', response: 'Partial' } }
    ]
    expect(await send(...invalid.map((fields) => event(1, { ...start, ...fields })))).toEqual(
      invalid.map(() => ({ ok: false, error: 'invalid' }))
    )
    const current = () => server.snapshot()[0]?.session?.telemetry
    const sixteen = Array.from({ length: 16 }, (_, index) => ({ ...loop, id: `job-${index}` }))
    expect(
      await send(
        event(1, {
          ...start,
          turn: { id: 'turn', status: 'working', trigger: 'schedule' },
          schedules: sixteen
        })
      )
    ).toEqual([accepted])
    expect(current()).toMatchObject({
      turn: { trigger: 'schedule' },
      schedules: sixteen
    })
    expect(await send(event(2, { ...start, schedules: [{ ...loop, nextRunAt: null }] }))).toEqual([
      accepted
    ])
    expect(current()?.schedules).toEqual([{ ...loop, nextRunAt: null }])
    expect(await send(event(3, start))).toEqual([accepted])
    expect(current()?.schedules).toBeNull()
    const response = '🐕'.repeat(2000)
    expect(
      await send(
        event(4, { ...start, turn: { id: 'turn', status: 'completed', trigger: 'user', response } })
      )
    ).toEqual([accepted])
    expect(current()?.turn).toEqual({ id: 'turn', status: 'completed', trigger: 'user', response })
  })

  it('validates and replaces conversation titles without changing ordering or event identity', async () => {
    await server.start()
    const { event, start, send } = session(server)
    const title = '🐕'.repeat(1024)
    const current = () => server.snapshot()[0]?.session
    expect(
      await send(event(1, { ...start, title: title + 'x' }), event(1, { ...start, title: 42 }))
    ).toEqual([
      { ok: false, error: 'invalid' },
      { ok: false, error: 'invalid' }
    ])
    expect(await send(event(1, { ...start, title }))).toEqual([accepted])
    expect(current()?.title).toBe(title)
    expect(await send(event(2, { ...start, title: 'Renamed' }))).toEqual([accepted])
    expect(current()?.title).toBe('Renamed')
    expect(await send(event(3, { ...start, title: null }))).toEqual([accepted])
    expect(current()?.title).toBeNull()
    expect(await send(event(3, { ...start, title: null }), event(3, start))).toEqual([
      { ok: true, status: 'duplicate' },
      { ok: false, error: 'conflict' }
    ])
    expect(await send(event(4, { ...start, title: 'Old conversation' }))).toEqual([accepted])
    expect(
      await send(
        event(5, { ...start, sessionId: 'new', sessionEpoch: 5 }),
        event(6, { ...start, title: 'Stale title' })
      )
    ).toEqual([accepted, { ok: true, status: 'stale' }])
    expect(current()).toMatchObject({ id: 'new', title: null })
    expect(
      await send(
        event(6, { ...start, sessionId: 'new', sessionEpoch: 5, title: 'New conversation' })
      )
    ).toEqual([accepted])
    expect(current()?.title).toBe('New conversation')
    expect(await send(event(7, { ...start, sessionId: 'new', sessionEpoch: 5 }))).toEqual([
      accepted
    ])
    expect(current()?.title).toBeNull()
  })

  it('recovers from missing snapshots and rejects stale, conflicting and ended selections', async () => {
    await server.start()
    const { event, start, send, launchId } = session(server)
    const stale = { ok: true, status: 'stale' }
    const conflict = { ok: false, error: 'conflict' }
    const state = { ok: false, error: 'state' }
    const notice = { kind: 'notification', title: 'Review', body: 'Ready' }
    const end = { kind: 'session.ended' }
    expect(await send(event(2, notice), event(3, end))).toEqual([state, state])
    expect(
      await send(
        event(4, start),
        event(4, { ...start, turn: { status: 'working', id: 'turn' } }),
        event(4, { ...start, tool: 'Read' })
      )
    ).toEqual([accepted, { ok: true, status: 'duplicate' }, conflict])
    expect(
      await send(
        event(3, start),
        event(5, { ...start, sessionId: 'other' }),
        event(5, { ...start, provider: 'claude' })
      )
    ).toEqual([stale, conflict, conflict])
    expect(await send(event(6, { ...start, turn: null, activeSubagents: 2 }))).toEqual([accepted])
    expect(server.snapshot()[0]?.session?.telemetry).toMatchObject({
      turn: null,
      activeSubagents: 2
    })
    expect(await send(event(7, notice), event(8, end), event(9, start), event(10, notice))).toEqual(
      [accepted, accepted, state, state]
    )
    expect(server.snapshot()[0]).toMatchObject({ process: 'active', session: { telemetry: null } })
    expect(
      await send(
        event(12, { ...start, sessionEpoch: 11, sessionId: 'new' }),
        event(50, start),
        event(13, { ...start, sessionEpoch: 11, sessionId: 'new' })
      )
    ).toEqual([accepted, stale, accepted])
    expect(server.snapshot()[0]?.session).toMatchObject({ id: 'new', epoch: 11 })
    server.markExited(launchId)
    expect(await send(event(51, start))).toEqual([{ ok: false, error: 'unauthorized' }])
  })
})
