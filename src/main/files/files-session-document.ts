import { isPlainObject } from '../../shared/plain-object'
import type { EditorTabSession, FilesSession } from '../../shared/files-session-api'

/** Bounds on what the renderer may store, so a bad or hostile page can't grow the file without end. */
const LIMITS = { expanded: 10_000, tabs: 500, viewCharacters: 100_000, sessions: 50 } as const

const isPath = (value: unknown): value is string => typeof value === 'string' && value !== ''

function parseTab(value: unknown): EditorTabSession | null {
  if (!isPlainObject(value) || !isPath(value.path)) return null
  const view =
    isPlainObject(value.view) && JSON.stringify(value.view).length <= LIMITS.viewCharacters
      ? value.view
      : null
  return { path: value.path, view }
}

/** A Files session from untrusted data, or null; damaged entries inside it are dropped. */
export function parseFilesSession(value: unknown): FilesSession | null {
  if (!isPlainObject(value)) return null
  if (!Array.isArray(value.expanded) || !Array.isArray(value.tabs)) return null
  const tabs = value.tabs
    .slice(0, LIMITS.tabs)
    .map(parseTab)
    .filter((tab) => tab !== null)
  const activePath =
    isPath(value.activePath) && tabs.some((tab) => tab.path === value.activePath)
      ? value.activePath
      : null
  return {
    expanded: value.expanded.slice(0, LIMITS.expanded).filter(isPath),
    hideIgnored: value.hideIgnored === true,
    tabs,
    activePath
  }
}

/** The default workspace has no file; its sessions are kept under this key. */
export const DEFAULT_WORKSPACE_KEY = ''

/**
 * Sessions by workspace, the most recently saved first, keeping the latest few: a workspace not
 * opened for a long time just starts with its Files view collapsed.
 */
export function withSession(
  sessions: [string, FilesSession][],
  key: string,
  session: FilesSession
): [string, FilesSession][] {
  const latest: [string, FilesSession] = [key, session]
  return [latest, ...sessions.filter(([other]) => other !== key)].slice(0, LIMITS.sessions)
}

/** The sessions in a stored document; unreadable ones are left out. */
export function parseFilesSessions(value: unknown): [string, FilesSession][] {
  if (!isPlainObject(value) || !Array.isArray(value.sessions)) return []
  return value.sessions.flatMap((entry): [string, FilesSession][] => {
    if (!isPlainObject(entry) || typeof entry.workspace !== 'string') return []
    const session = parseFilesSession(entry.session)
    return session ? [[entry.workspace, session]] : []
  })
}
