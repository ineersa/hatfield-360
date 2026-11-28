import { isPlainObject } from '../../shared/plain-object'

/** The live hunk session among `pids` (a terminal's processes) in `hunk session list --json`. */
export function sessionAmong(json: string, pids: ReadonlySet<number>): string | null {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    return null
  }
  if (!isPlainObject(value) || !Array.isArray(value['sessions'])) return null
  const sessions: unknown[] = value['sessions']
  for (const session of sessions) {
    if (!isPlainObject(session)) continue
    const { sessionId, pid } = session
    if (typeof sessionId === 'string' && typeof pid === 'number' && pids.has(pid)) return sessionId
  }
  return null
}

/** How many notes `hunk session comment list --json` lists; null when it isn't that list. */
export function noteCount(json: string): number | null {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    return null
  }
  return isPlainObject(value) && Array.isArray(value['comments']) ? value['comments'].length : null
}
