import { realpath, stat } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { basename, isAbsolute } from 'node:path'
import { promisify } from 'node:util'
import type { AgentProfile } from '../../shared/agent-api'
import type { ShellCommand } from '../terminal/default-shell'
import { agentShellCommand } from '../terminal/agent-shell-command'
import { isPlainObject } from '../../shared/plain-object'
import {
  conversationKey,
  RECENT_CONVERSATION_MS,
  type RecentCatalog,
  type RecentConversation
} from '../../shared/recent-conversation'
import type { WorkspaceView } from '../../shared/workspace-api'
import type { ProjectWorktrees } from '../../shared/worktree-api'
import { catalogScopes } from './catalog-scopes'

const execute = promisify(execFile)

export function isMissingHatfieldCatalog(error: unknown): boolean {
  return (
    error instanceof Error &&
    'stderr' in error &&
    typeof error.stderr === 'string' &&
    /no such table:\s*hatfield_session\b/.test(error.stderr)
  )
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

export async function listHatfieldCatalog(
  folders: WorkspaceView['folders'],
  projects: ProjectWorktrees[],
  profile: AgentProfile,
  now = Date.now()
): Promise<RecentCatalog> {
  const entries = new Map<string, RecentConversation>()
  const errors = new Set<string>()
  const scopeAliases = new Map<string, string>()
  const since = new Date(now - RECENT_CONVERSATION_MS).toISOString()
  for (const [cwd, project] of catalogScopes(folders, projects)) {
    try {
      const canonical = await realpath(cwd)
      if (!(await stat(canonical)).isDirectory()) throw new Error('Not a directory.')
      if (cwd !== canonical) scopeAliases.set(cwd, canonical)
    } catch {
      errors.add(`Hatfield: the ${basename(cwd)} catalog folder is unavailable.`)
      continue
    }
    let offset = 0
    try {
      for (;;) {
        const command = hatfieldCatalogCommand(profile, cwd, since, offset)
        const { stdout } = await execute(command.file, command.args, {
          encoding: 'utf8',
          maxBuffer: 2 * 1024 * 1024,
          timeout: 15_000,
          windowsHide: true
        })
        const page = parseHatfieldCatalog(JSON.parse(stdout) as unknown, project, now)
        for (const entry of page.sessions) {
          const key = conversationKey(entry)
          if (key && (entries.get(key)?.lastModified ?? 0) <= entry.lastModified)
            entries.set(key, entry)
        }
        if (page.nextOffset === null) break
        if (page.nextOffset <= offset || page.nextOffset > 20_000)
          throw new Error('Invalid or excessive session:list pagination.')
        offset = page.nextOffset
      }
    } catch (error) {
      if (isMissingHatfieldCatalog(error)) continue
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        errors.add('Hatfield: the configured command could not be started.')
        break
      }
      errors.add(`Hatfield: could not read the ${basename(cwd)} catalog.`)
    }
  }
  return { sessions: [...entries.values()], errors: [...errors], scopeAliases }
}
