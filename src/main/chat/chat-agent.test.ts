import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ChatEvent } from '../../shared/chat-agent-api'
import { ChatAgentSession } from './chat-agent'
import { WorkspaceMapFile } from './workspace-map-file'
import { isPlainObject } from '../../shared/plain-object'
import { parseCassette } from '../../../tests/fixtures/acp/cassette.mjs'

const fixtures = resolve(import.meta.dirname, '../../../tests/fixtures/acp')

let work: string
let cwd: string
let mapPath: string

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'chat-agent-'))
  cwd = join(work, 'repo')
  mapPath = join(work, 'map.workspace.md')
  await cp(join(fixtures, 'repo'), cwd, { recursive: true })
})
afterEach(() => rm(work, { recursive: true, force: true }))

/** A chat against the replayed cassette; resolves with every event once `until` arrives. */
function replay(
  cassette: string,
  drive: (chat: ChatAgentSession, event: ChatEvent) => void,
  until: (event: ChatEvent) => boolean
): { chat: ChatAgentSession; events: Promise<ChatEvent[]> } {
  const events: ChatEvent[] = []
  const settlers: ((events: ChatEvent[]) => void)[] = []
  const finished = new Promise<ChatEvent[]>((settle) => settlers.push(settle))
  const chat: ChatAgentSession = new ChatAgentSession(
    {
      command: () =>
        Promise.resolve({
          file: process.execPath,
          args: [join(fixtures, 'acp-replayer.mjs')],
          env: {
            PATH: process.env['PATH'] ?? '',
            HATFIELD_CHAT_CASSETTE: join(fixtures, `${cassette}.jsonl`)
          }
        }),
      cwd,
      additionalDirectories: [],
      mapFile: new WorkspaceMapFile(mapPath),
      preferred: { model: 'haiku', effort: 'medium' }
    },
    (event) => {
      events.push(event)
      if (until(event) || event.kind === 'ended') for (const settle of settlers) settle(events)
      else drive(chat, event)
    },
    () => undefined
  )
  void chat.open()
  return { chat, events: finished }
}

const kinds = (events: ChatEvent[]): string[] => [...new Set(events.map((event) => event.kind))]
const replyText = (events: ChatEvent[]): string =>
  events.map((event) => (event.kind === 'text' ? event.text : '')).join('')

describe('ChatAgentSession against recorded Claude Code', () => {
  it('answers with a tool call and a file:line reference, on Haiku at medium effort', async () => {
    const { chat, events } = replay(
      'answer',
      (session, event) => {
        if (event.kind === 'ready')
          session.prompt(
            'Where is the greeting implemented? Reply in one sentence with a path:line reference.'
          )
      },
      (event) => event.kind === 'turn-end'
    )
    const seen = await events
    expect(kinds(seen)).not.toContain('error')
    const ready = seen.find((event) => event.kind === 'ready')
    expect(
      ready?.kind === 'ready' &&
        ready.configOptions.map((option) => [option.id, option.currentValue])
    ).toEqual([
      ['model', 'haiku'],
      ['effort', 'medium'],
      ['mode', 'auto']
    ])
    expect(seen.some((event) => event.kind === 'tool' && event.status === 'completed')).toBe(true)
    expect(replyText(seen)).toContain('src/greeting.js:2')
    expect(seen.at(-1)).toMatchObject({ kind: 'turn-end', stopReason: 'end_turn' })
    chat.end()
    await chat.exited()
  })

  it('reports a client message the cassette does not expect as an error and ends the chat', async () => {
    const { events } = replay(
      'answer',
      (session, event) => {
        if (event.kind === 'ready') session.prompt('A prompt the recording never saw')
      },
      () => false
    )
    const seen = await events
    const error = seen.find((event) => event.kind === 'error')
    expect(error?.kind === 'error' && error.message).toContain("doesn't match the client")
    expect(seen.at(-1)?.kind).toBe('ended')
  })
})

describe('the recorded cassettes', () => {
  it('come from the installed ACP adapter', async () => {
    const manifest: unknown = JSON.parse(
      await readFile(
        createRequire(import.meta.url).resolve(
          '@agentclientprotocol/claude-agent-acp/package.json'
        ),
        'utf8'
      )
    )
    const installed = isPlainObject(manifest) ? manifest['version'] : null
    const cassettes = (await readdir(fixtures)).filter((name) => name.endsWith('.jsonl'))
    expect(cassettes.length).toBeGreaterThan(0)
    for (const name of cassettes) {
      const { header } = parseCassette(await readFile(join(fixtures, name), 'utf8'))
      // After an adapter upgrade, re-record them: pnpm record:chat-cassettes
      expect({ name, adapter: header.adapter }).toEqual({ name, adapter: installed })
    }
  })
})

describe('the workspace map file', () => {
  it('keeps the user text when the map block is replaced', async () => {
    await writeFile(mapPath, 'My rules.\n')
    await new WorkspaceMapFile(mapPath).writeMap('<!-- workspace -->\n# Map\n<!-- /workspace -->')
    expect(await readFile(mapPath, 'utf8')).toBe(
      'My rules.\n\n<!-- workspace -->\n# Map\n<!-- /workspace -->\n'
    )
  })
})
