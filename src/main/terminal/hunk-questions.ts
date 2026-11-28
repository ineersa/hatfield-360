import { dirname } from 'node:path'
import { isPlainObject } from '../../shared/plain-object'

/** A question the user left in hunk: a note of theirs starting with `?`, not answered yet. */
export type HunkQuestion = {
  noteId: string
  filePath: string
  side: 'new' | 'old'
  range: readonly [number, number]
  /** What is asked, without the `?`. */
  text: string
}

/** The hunk selected in hunk's view: where Ask in Chat looks for questions. */
export type SelectedHunk = { filePath: string; hunkIndex: number }

/** A note that is only `?` asks this. */
const EXPLAIN = 'Explain what this code does and why it is written this way.'

const parse = (json: string): unknown => {
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

const rangeOf = (value: unknown): readonly [number, number] | null => {
  if (!Array.isArray(value) || value.length !== 2) return null
  const pair: unknown[] = value
  const start = pair[0]
  const end = pair[1]
  return typeof start === 'number' && typeof end === 'number' && start > 0 && end >= start
    ? [start, end]
    : null
}

/** The selected file and hunk of `hunk session get --json`; null when nothing is selected. */
export function selectedHunk(json: string): SelectedHunk | null {
  const value = parse(json)
  const session = isPlainObject(value) ? value['session'] : null
  const snapshot = isPlainObject(session) ? session['snapshot'] : null
  const state = isPlainObject(snapshot) ? snapshot['state'] : null
  if (!isPlainObject(state)) return null
  const { selectedFilePath, selectedHunkIndex } = state
  return typeof selectedFilePath === 'string' &&
    typeof selectedHunkIndex === 'number' &&
    Number.isInteger(selectedHunkIndex) &&
    selectedHunkIndex >= 0
    ? { filePath: selectedFilePath, hunkIndex: selectedHunkIndex }
    : null
}

/**
 * The unanswered questions in one hunk of `hunk session comment list --json`, in the list's order:
 * the user's own notes (not replies) whose text starts with `?`, with no reply under them yet. Null
 * when it isn't that list.
 */
export function questionsIn(json: string, hunk: SelectedHunk): HunkQuestion[] | null {
  const value = parse(json)
  if (!isPlainObject(value) || !Array.isArray(value['comments'])) return null
  const listed: unknown[] = value['comments']
  const notes = listed.filter(isPlainObject)
  if (notes.length !== listed.length) return null
  const answered = new Set(
    notes.map((note) => note['parentId']).filter((id) => typeof id === 'string')
  )
  const questions: HunkQuestion[] = []
  for (const note of notes) {
    const { noteId, parentId, source, filePath, hunkIndex, body } = note
    if (
      typeof noteId !== 'string' ||
      source !== 'user' ||
      parentId !== undefined ||
      filePath !== hunk.filePath ||
      hunkIndex !== hunk.hunkIndex ||
      typeof body !== 'string' ||
      answered.has(noteId)
    )
      continue
    const asked = body.trimStart()
    if (!asked.startsWith('?')) continue
    const newRange = rangeOf(note['newRange'])
    const oldRange = rangeOf(note['oldRange'])
    const range = newRange ?? oldRange
    if (range === null) continue
    const text = asked.slice(1).trim()
    questions.push({
      noteId,
      filePath,
      side: newRange ? 'new' : 'old',
      range,
      text: text === '' ? EXPLAIN : text
    })
  }
  return questions
}

/** `text` as one word for a POSIX shell. */
const shellWord = (text: string): string =>
  /^[\w./@%+=:,-]+$/.test(text) ? text : `'${text.replaceAll("'", "'\\''")}'`

const where = (question: HunkQuestion): string => {
  const [start, end] = question.range
  const lines = start === end ? `line ${start}` : `lines ${start}-${end}`
  return question.side === 'new'
    ? `${question.filePath}, ${lines}`
    : `${question.filePath}, ${lines} of the old version (removed or changed by the diff)`
}

/**
 * The chat's first message: the questions, where they are, and the one command that posts the
 * answers back as replies under them in hunk. `hunk` is the executable Hatfield found, as the
 * chat's PATH may not have it, nor the Node an npm install of hunk runs on beside it.
 */
export function askPrompt(
  hunk: string,
  session: string,
  questions: readonly HunkQuestion[]
): string {
  const command = `PATH=${shellWord(dirname(hunk))}:"$PATH" ${shellWord(hunk)} session`
  const items = questions.map(
    (question, index) =>
      `${index + 1}. ${where(question)} (note ${question.noteId}):\n   ${question.text.replaceAll('\n', '\n   ')}`
  )
  const replies = questions.map((question) => ({
    replyTo: question.noteId,
    summary: '<your answer>',
    author: 'Hatfield chat'
  }))
  return [
    `I'm reviewing a diff in hunk (session ${session}) and left questions on it. Answer each one. Read the code to answer; don't change any files.`,
    '',
    'Questions:',
    ...items,
    '',
    `To see the diff around them: ${command} review ${session} --include-notes --json`,
    '',
    'Then post every answer in one call, as replies under the questions in hunk:',
    '',
    `${command} comment apply ${session} --stdin <<'ANSWERS'`,
    JSON.stringify({ comments: replies }, null, 2),
    'ANSWERS',
    '',
    'Keep each answer to a few sentences, and reply here with a short summary too.'
  ].join('\n')
}
