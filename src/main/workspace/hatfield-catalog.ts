import { realpath, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { basename, isAbsolute, join } from 'node:path'
import type { AgentProfile } from '../../shared/agent-api'
import type { ShellCommand } from '../terminal/default-shell'
import { agentShellCommand } from '../terminal/agent-shell-command'
import { isPlainObject } from '../../shared/plain-object'
import { mapWithConcurrency } from '../../shared/limited-concurrency'
import {
  conversationKey,
  RECENT_CONVERSATION_MS,
  type RecentCatalog,
  type RecentConversation
} from '../../shared/recent-conversation'
import type { WorkspaceView } from '../../shared/workspace-api'
import type { ProjectWorktrees } from '../../shared/worktree-api'
import { catalogScopes } from './catalog-scopes'

/** A failed run, with the fields execFile would set, which the catalog notice reads. */
class CatalogRunError extends Error {
  constructor(
    message: string,
    readonly code: number | string | null,
    readonly signal: NodeJS.Signals | null,
    readonly killed: boolean,
    readonly stderr: string
  ) {
    super(message)
  }
}

const OUTPUT_LIMIT = 2 * 1024 * 1024

/** The command's stdout; spawn, unlike execFile, can start it in a session of its own. */
function execute(command: ShellCommand, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command.file, command.args, {
      env,
      // An interactive shell would take over the terminal `pnpm dev` runs in and stop main.
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    let stdout = ''
    let stderr = ''
    let killed = false
    let overflow = false
    const kill = (): void => {
      killed = true
      child.kill('SIGTERM')
    }
    const timer = setTimeout(kill, CATALOG_TIMEOUT_MS)
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk
      if (stdout.length <= OUTPUT_LIMIT) return
      overflow = true
      kill()
    })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-OUTPUT_LIMIT)
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (code === 0 && !killed) resolve(stdout)
      else if (overflow) reject(new Error('session:list printed more than 2 MB.'))
      else reject(new CatalogRunError('session:list failed.', code, signal, killed, stderr))
    })
  })
}

export function isMissingHatfieldCatalog(error: unknown): boolean {
  return (
    error instanceof Error &&
    'stderr' in error &&
    typeof error.stderr === 'string' &&
    /no such table:\s*hatfield_session\b/.test(error.stderr)
  )
}

const CATALOG_TIMEOUT_MS = 15_000

/** Thrown for output that isn't a session list, so the failure names that instead of a parse error. */
class CatalogOutputError extends Error {}

function catalogJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout) as unknown
  } catch {
    throw new CatalogOutputError(
      'its output is not session:list JSON; does a shell startup file print?'
    )
  }
}

/** The last line of a failed command's stderr, as plain text short enough for a notice. */
function stderrTail(stderr: unknown): string {
  if (typeof stderr !== 'string') return ''
  const line =
    stderr
      .split('\n')
      .map((text) =>
        Array.from(text)
          .filter((character) => character >= ' ' && character !== '\x7f')
          .join('')
          .trim()
      )
      .findLast((text) => text !== '') ?? ''
  return line.length > 200 ? `${line.slice(0, 199)}…` : line
}

/** Why a session:list run failed, for the catalog notice: exit status, timeout or bad output. */
function catalogFailure(error: unknown): string {
  if (error instanceof CatalogOutputError) return error.message
  if (!(error instanceof Error)) return String(error)
  const fields = new Map<string, unknown>(Object.entries(error))
  const code = fields.get('code')
  const signal = fields.get('signal')
  const tail = stderrTail(fields.get('stderr'))
  const detail = tail ? `: ${tail}` : ''
  if (fields.get('killed') === true && signal === 'SIGTERM')
    return `no answer within ${CATALOG_TIMEOUT_MS / 1000} seconds`
  if (code === 127) return `the configured command could not be started, exit 127${detail}`
  if (typeof code === 'number') return `exit ${code}${detail}`
  if (typeof signal === 'string') return `stopped by ${signal}${detail}`
  return error.message
}

export function parseHatfieldCatalog(
  value: unknown,
  project: string,
  now: number
): {
  sessions: RecentConversation[]
  nextOffset: number | null
} {
  if (
    !isPlainObject(value) ||
    value.version !== 1 ||
    !isPlainObject(value.scope) ||
    typeof value.scope.cwd !== 'string' ||
    !isAbsolute(value.scope.cwd) ||
    !Array.isArray(value.sessions) ||
    value.sessions.length > 200 ||
    !(
      value.nextOffset === null ||
      (typeof value.nextOffset === 'number' &&
        Number.isSafeInteger(value.nextOffset) &&
        value.nextOffset >= 0)
    )
  )
    throw new Error('Invalid session:list response.')
  const resumeCwd = value.scope.cwd
  const sessions: RecentConversation[] = []
  for (const row of value.sessions) {
    if (
      !isPlainObject(row) ||
      typeof row.sessionId !== 'string' ||
      !/^\d{1,128}$/.test(row.sessionId) ||
      typeof row.displayTitle !== 'string' ||
      row.displayTitle.length > 1024 ||
      typeof row.cwd !== 'string' ||
      !isAbsolute(row.cwd) ||
      typeof row.updatedAt !== 'string'
    )
      throw new Error('Invalid session:list session.')
    const lastModified = Date.parse(row.updatedAt)
    if (!Number.isFinite(lastModified)) throw new Error('Invalid session:list activity timestamp.')
    if (lastModified <= now - RECENT_CONVERSATION_MS) continue
    sessions.push({
      provider: 'hatfield',
      providerSessionId: row.sessionId,
      title: row.displayTitle || null,
      cwd: row.cwd,
      resumeCwd,
      project,
      branch: null,
      lastModified
    })
  }
  return { sessions, nextOffset: value.nextOffset }
}

export function hatfieldCatalogCommand(
  profile: AgentProfile,
  cwd: string,
  since: string,
  offset: number,
  shell?: ShellCommand
): ShellCommand {
  return agentShellCommand(
    {
      ...profile,
      args: [
        ...profile.args,
        'session:list',
        '--json',
        '--cwd',
        cwd,
        '--since',
        since,
        '--limit',
        '200',
        '--offset',
        String(offset)
      ]
    },
    cwd,
    shell
  )
}

/** A folder's sessions as last listed, with the store's state then: unchanged, it needn't be asked again. */
const listed = new Map<string, { stamp: string; sessions: RecentConversation[] }>()

/** How many folders are asked at once: each answer starts a shell and the agent. */
const CATALOG_CONCURRENCY = 4

/** The state of a folder's Hatfield store (`.hatfield/state.sqlite` and its write-ahead log); null without one. */
async function storeStamp(folder: string): Promise<string | null> {
  const database = join(folder, '.hatfield', 'state.sqlite')
  const files = await Promise.all(
    [database, `${database}-wal`].map((file) =>
      stat(file).then(
        ({ mtimeMs, size }) => [mtimeMs, size],
        () => null
      )
    )
  )
  return files[0] === null ? null : JSON.stringify(files)
}

type ScopeResult = { sessions: RecentConversation[]; error?: string; alias?: string }

async function listScope(
  cwd: string,
  project: string,
  profile: AgentProfile,
  since: string,
  now: number,
  shell: ShellCommand | undefined
): Promise<ScopeResult> {
  let canonical: string
  try {
    canonical = await realpath(cwd)
    if (!(await stat(canonical)).isDirectory()) throw new Error('Not a directory.')
  } catch {
    return { sessions: [], error: `Hatfield: the ${basename(cwd)} catalog folder is unavailable.` }
  }
  const alias = cwd === canonical ? {} : { alias: canonical }
  // Without a store Hatfield has no sessions here, and asking it would create one.
  const stamp = await storeStamp(canonical)
  if (stamp === null) return { sessions: [], ...alias }
  const key = JSON.stringify([cwd, project, profile])
  const cached = listed.get(key)
  if (cached?.stamp === stamp) return { sessions: cached.sessions, ...alias }
  const sessions: RecentConversation[] = []
  let offset = 0
  try {
    for (;;) {
      const command = hatfieldCatalogCommand(profile, cwd, since, offset, shell)
      const stdout = await execute(command, { ...process.env, ...profile.env })
      const page = parseHatfieldCatalog(catalogJson(stdout), project, now)
      sessions.push(...page.sessions)
      if (page.nextOffset === null) break
      if (page.nextOffset <= offset || page.nextOffset > 20_000)
        throw new Error('Invalid or excessive session:list pagination.')
      offset = page.nextOffset
    }
  } catch (error) {
    if (isMissingHatfieldCatalog(error)) return { sessions: [], ...alias }
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return { sessions: [], error: 'Hatfield: the configured command could not be started.' }
    return {
      sessions: [],
      error: `Hatfield: could not read the ${basename(cwd)} catalog (${catalogFailure(error)}).`,
      ...alias
    }
  }
  listed.set(key, { stamp, sessions })
  return { sessions, ...alias }
}

export async function listHatfieldCatalog(
  folders: WorkspaceView['folders'],
  projects: ProjectWorktrees[],
  profile: AgentProfile,
  now = Date.now(),
  shell?: ShellCommand
): Promise<RecentCatalog> {
  const since = new Date(now - RECENT_CONVERSATION_MS).toISOString()
  const scopes = [...catalogScopes(folders, projects)]
  const results = await mapWithConcurrency(scopes, CATALOG_CONCURRENCY, ([cwd, project]) =>
    listScope(cwd, project, profile, since, now, shell)
  )
  const entries = new Map<string, RecentConversation>()
  const errors = new Set<string>()
  const scopeAliases = new Map<string, string>()
  scopes.forEach(([cwd], index) => {
    const result = results[index]
    if (!result) return
    if (result.alias !== undefined) scopeAliases.set(cwd, result.alias)
    if (result.error !== undefined) errors.add(result.error)
    for (const entry of result.sessions) {
      const key = conversationKey(entry)
      if (key && (entries.get(key)?.lastModified ?? 0) <= entry.lastModified)
        entries.set(key, entry)
    }
  })
  return { sessions: [...entries.values()], errors: [...errors], scopeAliases }
}
