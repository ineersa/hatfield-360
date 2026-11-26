import { execFile } from 'node:child_process'
import { basename, isAbsolute } from 'node:path'
import { promisify } from 'node:util'
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

export async function listHatfieldCatalog(
  folders: WorkspaceView['folders'],
  projects: ProjectWorktrees[],
  now = Date.now()
): Promise<RecentCatalog> {
  const entries = new Map<string, RecentConversation>()
  const errors = new Set<string>()
  for (const [cwd, project] of catalogScopes(folders, projects)) {
    let offset = 0
    try {
      for (;;) {
        const { stdout } = await execute(
          'hatfield',
          [
            'session:list',
            '--json',
            '--cwd',
            cwd,
            '--since',
            new Date(now - RECENT_CONVERSATION_MS).toISOString(),
            '--limit',
            '200',
            '--offset',
            String(offset)
          ],
          { cwd, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 15_000, windowsHide: true }
        )
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
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        errors.add('Hatfield: command not found on PATH.')
        break
      }
      errors.add(`Hatfield: could not read the ${basename(cwd)} catalog.`)
    }
  }
  return { sessions: [...entries.values()], errors: [...errors] }
}
