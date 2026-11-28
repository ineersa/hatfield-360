import { isPlainObject } from '../../shared/plain-object'
import type { DiscussionComment, ReviewThread } from '../git/pull-request-discussion'

/** One note of `hunk session comment list --json`. */
export type HunkNote = {
  noteId: string
  /** The note it replies to. */
  parentId: string | null
  /** 'user' for notes typed in hunk; others came from agents, or from GitHub through Hatfield. */
  source: string
  filePath: string
  side: 'new' | 'old' | null
  range: readonly [number, number] | null
  body: string
}

/** One item of a `hunk session comment apply --stdin` batch. */
export type ApplyItem = Readonly<Record<string, string | number>>

/** What a note Hatfield loaded from GitHub stands for. */
export type LoadedNote =
  /** A review thread's comment; replies go to the thread's first comment. */
  | { kind: 'thread'; commentId: number }
  /** A comment on the pull request itself. */
  | { kind: 'conversation'; author: string; body: string }

/** A new review comment, as `POST /repos/{owner}/{repo}/pulls/{n}/reviews` takes it. */
type NewReviewComment = {
  path: string
  line: number
  side: 'LEFT' | 'RIGHT'
  start_line?: number
  start_side?: 'LEFT' | 'RIGHT'
  body: string
}

/** Something to post, and the user's notes it was made from, which go once it's posted. */
type Planned<T> = { post: T; noteIds: string[] }

export type PublishPlan = {
  /** New threads, posted together as one review. */
  review: Planned<NewReviewComment>[]
  /** Replies in GitHub review threads. */
  replies: Planned<{ commentId: number; body: string }>[]
  /** Replies to comments on the pull request itself, which GitHub doesn't thread. */
  conversation: Planned<string>[]
  /** Notes that can't be posted: not on a line. */
  unplaced: number
}

/** The mark that tells a comment on the pull request itself from a line's. */
const CONVERSATION_MARK = 'GitHub PR Comment'

const rangeOf = (value: unknown): readonly [number, number] | null => {
  if (!Array.isArray(value) || value.length !== 2) return null
  const pair: unknown[] = value
  const start = pair[0]
  const end = pair[1]
  return typeof start === 'number' && typeof end === 'number' && start > 0 && end >= start
    ? [start, end]
    : null
}

/** The notes of `hunk session comment list --json`; null when it isn't that list. */
export function parseNoteList(json: string): HunkNote[] | null {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    return null
  }
  if (!isPlainObject(value) || !Array.isArray(value['comments'])) return null
  const listed: unknown[] = value['comments']
  const notes: HunkNote[] = []
  for (const note of listed) {
    if (!isPlainObject(note)) return null
    const { noteId, parentId, source, filePath, body } = note
    if (typeof noteId !== 'string' || typeof source !== 'string' || typeof filePath !== 'string')
      return null
    const newRange = rangeOf(note['newRange'])
    const oldRange = rangeOf(note['oldRange'])
    notes.push({
      noteId,
      parentId: typeof parentId === 'string' ? parentId : null,
      source,
      filePath,
      side: newRange ? 'new' : oldRange ? 'old' : null,
      range: newRange ?? oldRange,
      body: typeof body === 'string' ? body : ''
    })
  }
  return notes
}

const said = (body: string) => body.trim() || '(no text)'

/** A thread's first comment, on its line (or its file's first hunk); null when it has no place in the diff. */
export function threadRoot(thread: ReviewThread): ApplyItem | null {
  const [first] = thread.comments
  if (first === undefined) return null
  // A comment on a whole file comes with line 1, which the diff may not show.
  const at = thread.onFile
    ? { hunk: 1 }
    : thread.line !== null
      ? { [thread.side === 'new' ? 'newLine' : 'oldLine']: thread.line }
      : null
  return at && { filePath: thread.path, ...at, summary: said(first.body), author: first.author }
}

/** A comment on the pull request itself, shown on the diff's first hunk. */
export function conversationRoot(comment: DiscussionComment, file: string): ApplyItem {
  return {
    filePath: file,
    hunk: 1,
    summary: said(comment.body),
    author: `${comment.author} · ${CONVERSATION_MARK}`
  }
}

export function replyTo(noteId: string, comment: DiscussionComment): ApplyItem {
  return { replyTo: noteId, summary: said(comment.body), author: comment.author }
}

/** The first line of what was said, as a Markdown quote. */
const quote = (body: string, author?: string): string => {
  const line = body.trim().split('\n')[0] ?? ''
  const short = line.length > 200 ? `${line.slice(0, 200)}…` : line
  return `> ${author === undefined ? '' : `${author}: `}${short}\n\n`
}

/**
 * What publishing the user's notes posts. A note of the user's and their replies under it become
 * one comment. Under a GitHub thread, that's a reply in it; under a pull request comment, a new
 * comment quoting it; under an agent's note, or on its own, a new thread on its line. Notes loaded
 * from GitHub, and other agents' notes, aren't posted.
 */
export function publishPlan(
  notes: readonly HunkNote[],
  loaded: ReadonlyMap<string, LoadedNote>
): PublishPlan {
  const byId = new Map(notes.map((note) => [note.noteId, note]))
  const users = notes.filter((note) => note.source === 'user')
  /** The user's note that starts the chain of the user's notes `note` is in. */
  const headOf = (note: HunkNote): HunkNote => {
    const parent = note.parentId === null ? undefined : byId.get(note.parentId)
    return parent?.source === 'user' ? headOf(parent) : note
  }
  const chains = new Map<HunkNote, HunkNote[]>()
  for (const note of users) {
    const head = headOf(note)
    chains.set(head, [...(chains.get(head) ?? []), note])
  }
  const plan: PublishPlan = { review: [], replies: [], conversation: [], unplaced: 0 }
  for (const [head, chain] of chains) {
    const noteIds = chain.map((note) => note.noteId)
    const body = chain
      .map((note) => note.body.trim())
      .filter((text) => text !== '')
      .join('\n\n')
    if (body === '') continue
    const answered = head.parentId === null ? undefined : loaded.get(head.parentId)
    if (answered?.kind === 'thread') {
      plan.replies.push({ post: { commentId: answered.commentId, body }, noteIds })
      continue
    }
    if (answered?.kind === 'conversation') {
      plan.conversation.push({ post: quote(answered.body, answered.author) + body, noteIds })
      continue
    }
    if (head.range === null || head.side === null) {
      plan.unplaced += chain.length
      continue
    }
    const parent = head.parentId === null ? undefined : byId.get(head.parentId)
    const side = head.side === 'new' ? 'RIGHT' : 'LEFT'
    const [start, end] = head.range
    plan.review.push({
      post: {
        path: head.filePath,
        line: end,
        side,
        ...(start < end ? { start_line: start, start_side: side } : {}),
        body: (parent ? quote(parent.body) : '') + body
      },
      noteIds
    })
  }
  return plan
}

/** The ids of the notes `hunk session comment apply --json` added, in the batch's order. */
export function appliedIds(json: string): string[] | null {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    return null
  }
  const result = isPlainObject(value) ? value['result'] : null
  const applied: unknown = isPlainObject(result) ? result['applied'] : null
  if (!Array.isArray(applied)) return null
  const items: unknown[] = applied
  const ids = items.map((item) =>
    isPlainObject(item) && typeof item['commentId'] === 'string' ? item['commentId'] : null
  )
  return ids.every((id) => id !== null) ? ids : null
}

/** The first file of `hunk session get --json`, where comments on the whole pull request go. */
export function firstFile(json: string): string | null {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    return null
  }
  const session = isPlainObject(value) ? value['session'] : null
  const files: unknown = isPlainObject(session) ? session['files'] : null
  if (!Array.isArray(files)) return null
  const list: unknown[] = files
  const first = list[0]
  return isPlainObject(first) && typeof first['path'] === 'string' ? first['path'] : null
}
