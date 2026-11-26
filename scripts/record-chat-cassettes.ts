// Re-records every workspace chat cassette from real Claude Code (`pnpm record:chat-cassettes`).
// Needs a logged-in `claude` on your shell's PATH.
// Each session runs through the app's own ACP client, with the adapter behind acp-tee.mjs.
import { execFileSync } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { ChatEvent } from '../src/shared/chat-agent-api'
import { isPlainObject } from '../src/shared/plain-object'
import { ChatAgentSession } from '../src/main/chat/chat-agent'
import { chatAgentCommand, resolveClaude } from '../src/main/chat/chat-agent-launch'
import { WorkspaceMapFile } from '../src/main/chat/workspace-map-file'
import { normalize, serializeCassette } from '../tests/fixtures/acp/cassette.mjs'

const root = resolve(import.meta.dirname, '..')
const fixtures = join(root, 'tests', 'fixtures', 'acp')
const require = createRequire(import.meta.url)
const adapterPackage = require.resolve('@agentclientprotocol/claude-agent-acp/package.json')
const adapterManifest: unknown = JSON.parse(await readFile(adapterPackage, 'utf8'))
const adapterVersion =
  isPlainObject(adapterManifest) && typeof adapterManifest.version === 'string'
    ? adapterManifest.version
    : 'unknown'

/** Drives one chat: a wait for the next event that matches, failing if the chat ends first. */
class Driver {
  private waiters: ((event: ChatEvent) => boolean)[] = []

  receive = (event: ChatEvent): void => {
    if (event.kind === 'error') console.error(`  agent error: ${event.message}`)
    this.waiters = this.waiters.filter((waiter) => !waiter(event))
  }

  next<E extends ChatEvent>(test: (event: ChatEvent) => event is E): Promise<E> {
    return new Promise((settle, reject) => {
      this.waiters.push((event) => {
        if (test(event)) settle(event)
        else if (event.kind === 'ended') reject(new Error('The chat ended early'))
        else return false
        return true
      })
    })
  }
}

/** Matches an event of this kind that passes `also`. */
const is =
  <K extends ChatEvent['kind']>(kind: K, also: (event: ChatEvent) => boolean = () => true) =>
  (event: ChatEvent): event is Extract<ChatEvent, { kind: K }> =>
    event.kind === kind && also(event)

type Script = (chat: ChatAgentSession, driver: Driver, cwd: string) => Promise<void>

const turn = (driver: Driver) => driver.next(is('turn-end'))

/**
 * A reply naming files in prose, in every form the chat links, one that doesn't exist and an
 * absolute link into the project; tests/e2e/chat.spec.ts sends the same.
 */
const linksPrompt = (cwd: string): string =>
  [
    'Without using any tools, reply with exactly this text and nothing else:',
    '',
    `The greeting is in src/greeting.js:2:10 and is called from __src/main.js:1, 3__; the readme is **README.md**, see also \`src/greeting.js#L2-L3\` and [its last line](<${cwd}/src/greeting.js#L3>). There is no src/missing.js:4.`
  ].join('\n')

/** The scripted sessions, one cassette each; README.md describes what each must contain. */
const SCRIPTS: Record<string, Script> = {
  answer: async (chat, driver) => {
    chat.prompt(
      'Where is the greeting implemented? Reply in one sentence with a path:line reference.'
    )
    await turn(driver)
  },
  links: async (chat, driver, cwd) => {
    chat.prompt(linksPrompt(cwd))
    await turn(driver)
  },
  permission: async (chat, driver) => {
    await chat.setConfig('mode', 'default')
    chat.prompt('Create the file notes.txt containing the word hello, with the Write tool.')
    const request = await driver.next(is('permission'))
    const allow = request.options.find((option) => option.kind === 'allow_once')
    if (!allow) throw new Error('The permission request has no Allow option')
    chat.answerPermission(request.requestId, allow.optionId)
    await turn(driver)
  },
  cancel: async (chat, driver) => {
    chat.prompt('Use Bash to run exactly this command: sleep 20; echo finished')
    await driver.next(
      is('tool', (event) => event.kind === 'tool' && event.input?.includes('sleep 20') === true)
    )
    chat.stop()
    const end = await turn(driver)
    if (end.stopReason !== 'cancelled')
      throw new Error(`The turn ended ${end.stopReason}, not cancelled`)
  },
  map: async (chat, driver) => {
    // Both arrive in one go: wait for them together.
    const written = driver.next(is('map-written'))
    const ended = turn(driver)
    chat.generateMap()
    await written
    await ended
  },
  playbook: async (chat, driver) => {
    chat.prompt('Save this to the playbook: run the tests with npm test.')
    await turn(driver)
  }
}

async function record(name: string, script: Script, claude: string): Promise<void> {
  const work = await mkdtemp(join(tmpdir(), `chat-cassette-${name}-`))
  try {
    const cwd = join(work, 'repo')
    await cp(join(fixtures, 'repo'), cwd, { recursive: true })
    const log = join(work, 'log.jsonl')
    const mapFile = new WorkspaceMapFile(join(work, 'map.workspace.md'))
    const driver = new Driver()
    process.env.HATFIELD_CHAT_AGENT_SCRIPT = join(dirname(adapterPackage), 'dist', 'index.js')
    const chat = new ChatAgentSession(
      {
        command: async () => {
          const command = chatAgentCommand(claude, 'cassette')
          return { ...command, args: [join(fixtures, 'acp-tee.mjs'), log, ...command.args] }
        },
        cwd,
        additionalDirectories: [],
        mapFile,
        preferred: { model: 'haiku', effort: 'medium' }
      },
      driver.receive,
      () => undefined
    )
    const ready = driver.next(is('ready'))
    void chat.open()
    await ready
    await script(chat, driver, cwd)
    chat.end()
    await chat.exited()
    const entries = (await readFile(log, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line): unknown => JSON.parse(line))
    const claudeVersion = execFileSync(claude, ['--version'], { encoding: 'utf8' }).trim()
    const cassette = serializeCassette(
      { cassette: name, adapter: adapterVersion, claude: claudeVersion },
      normalize(entries, { cwd, home: homedir() })
    )
    // A path left in would only match this machine and this run.
    for (const path of [work, homedir()])
      if (cassette.includes(path)) throw new Error(`${name}: the cassette still holds ${path}`)
    await writeFile(join(fixtures, `${name}.jsonl`), cassette)
    process.stdout.write(`Recorded ${name}.jsonl (${entries.length} messages)\n`)
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

const claude = await resolveClaude({ executable: 'claude', args: [] }, root)
const only = process.argv.slice(2)
for (const [name, script] of Object.entries(SCRIPTS)) {
  if (only.length > 0 && !only.includes(name)) continue
  await record(name, script, claude)
}
