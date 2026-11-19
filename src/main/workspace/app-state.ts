import { readFile } from 'node:fs/promises'
import { isPlainObject } from '../../shared/plain-object'
import { writeFileAtomic } from './atomic-write'

export type RecentItem = { kind: 'workspace' | 'folder'; path: string }

/** `userData/state.json`: which workspace is open and what was opened recently. App-owned, not user settings. */
export type AppState = {
  /** The open workspace file, or null for the default workspace. */
  current: string | null
  recent: RecentItem[]
}

const APP_STATE_VERSION = 1
const RECENT_LIMIT_PER_KIND = 10

function isRecentItem(value: unknown): value is RecentItem {
  return (
    isPlainObject(value) &&
    (value.kind === 'workspace' || value.kind === 'folder') &&
    typeof value.path === 'string' &&
    value.path !== ''
  )
}

/** Unreadable state only loses the Recent list, so bad parts are dropped rather than reported. */
export async function readAppState(file: string): Promise<AppState> {
  let data: unknown
  try {
    data = JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return { current: null, recent: [] }
  }
  if (!isPlainObject(data)) return { current: null, recent: [] }
  const current = typeof data.current === 'string' && data.current !== '' ? data.current : null
  const recent = Array.isArray(data.recent) ? data.recent.filter(isRecentItem) : []
  return { current, recent: recent.map(({ kind, path }) => ({ kind, path })) }
}

export function writeAppState(file: string, state: AppState): Promise<void> {
  const contents = { version: APP_STATE_VERSION, ...state }
  return writeFileAtomic(file, `${JSON.stringify(contents, null, 2)}\n`)
}

/** Moves an item to the top of Recent, keeping the most recent few of each kind. */
export function withRecent(recent: RecentItem[], item: RecentItem): RecentItem[] {
  const others = recent.filter((entry) => !(entry.kind === item.kind && entry.path === item.path))
  const sameKind = others.filter((entry) => entry.kind === item.kind)
  const dropped = new Set(sameKind.slice(RECENT_LIMIT_PER_KIND - 1))
  return [item, ...others.filter((entry) => !dropped.has(entry))]
}
