import { createHash } from 'node:crypto'
import { isPlainObject } from '../../shared/plain-object'

/** A review note as Hatfield keeps it between hunk runs: where it was and what it said. */
export type SavedNote = {
  filePath: string
  side: 'new' | 'old'
  line: number
  text: string
  author?: string
}

const SAVED_VERSION = 1

const positiveLine = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0

/** The first line of a `[start, end]` range from `hunk session comment list --json`. */
function rangeStart(value: unknown): number | null {
  if (!Array.isArray(value)) return null
  const range: unknown[] = value
  const start = range[0]
  return positiveLine(start) ? start : null
}

function noteOf(value: unknown): SavedNote | null {
  if (!isPlainObject(value)) return null
  const { filePath, body, newRange, oldRange, author, source } = value
  if (typeof filePath !== 'string' || filePath === '' || typeof body !== 'string' || body === '')
    return null
  const newLine = rangeStart(newRange)
  const oldLine = rangeStart(oldRange)
  const anchor =
    newLine !== null
      ? { side: 'new' as const, line: newLine }
      : oldLine !== null
        ? { side: 'old' as const, line: oldLine }
        : null
  if (anchor === null) return null
  const by = typeof author === 'string' && author !== '' ? author : source === 'user' ? 'you' : null
  return { filePath, ...anchor, text: body, ...(by === null ? {} : { author: by }) }
}

/**
 * The notes of `hunk session comment list --json`; null when it isn't that list. A note without a
 * line to anchor to (on a whole hunk) is left out: it can't be put back where it was.
 */
export function notesFromList(json: string): SavedNote[] | null {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    return null
  }
  if (!isPlainObject(value) || !Array.isArray(value['comments'])) return null
  const comments: unknown[] = value['comments']
  return comments.flatMap((comment) => {
    const note = noteOf(comment)
    return note === null ? [] : [note]
  })
}

/** The `hunk session comment apply --stdin` batch that puts the notes back. */
export function applyBatch(notes: readonly SavedNote[]): string {
  return JSON.stringify({
    comments: notes.map((note) => ({
      filePath: note.filePath,
      [note.side === 'new' ? 'newLine' : 'oldLine']: note.line,
      summary: note.text,
      ...(note.author === undefined ? {} : { author: note.author })
    }))
  })
}

export function savedNotesText(notes: readonly SavedNote[]): string {
  return `${JSON.stringify({ version: SAVED_VERSION, notes }, null, 2)}\n`
}

/** A saved notes file's notes; none when it can't be read as one. */
export function parseSavedNotes(content: string): SavedNote[] {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch {
    return []
  }
  if (!isPlainObject(value) || value['version'] !== SAVED_VERSION) return []
  const notes = value['notes']
  if (!Array.isArray(notes)) return []
  return notes.flatMap((note: unknown) => {
    if (!isPlainObject(note)) return []
    const { filePath, side, line, text, author } = note
    if (typeof filePath !== 'string' || filePath === '' || typeof text !== 'string' || text === '')
      return []
    if ((side !== 'new' && side !== 'old') || !positiveLine(line)) return []
    return [{ filePath, side, line, text, ...(typeof author === 'string' ? { author } : {}) }]
  })
}

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

/** The file name a review's notes are kept under: one per repository, kind and what it shows. */
export function notesFileName(parts: readonly string[]): string {
  return `${createHash('sha256').update(parts.join('\0')).digest('hex')}.json`
}
