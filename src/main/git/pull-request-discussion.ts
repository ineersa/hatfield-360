import { isPlainObject } from '../../shared/plain-object'

/** One GitHub comment: `id` is its REST id, which replies and publishing go by. */
export type DiscussionComment = { id: number; author: string; body: string; createdAt: string }

/** An unresolved review thread; its first comment is the one the others reply to. */
export type ReviewThread = {
  path: string
  side: 'new' | 'old'
  /** The line in the pull request's diff as it is now; null when outdated or on the whole file. */
  line: number | null
  /** On the file rather than a line. */
  onFile: boolean
  comments: DiscussionComment[]
}

/** What a pull request's discussion holds, as Hatfield shows it in hunk. */
export type Discussion = {
  /** The head commit the threads' lines refer to, which publishing anchors new comments to. */
  head: string
  /** Unresolved only: resolved threads are done with. */
  threads: ReviewThread[]
  /** Comments on the pull request itself, and the text of submitted reviews, oldest first. */
  conversation: DiscussionComment[]
  /** Threads, comments and reviews past the first 100 of each, which weren't read. */
  missing: number
}

/** The GraphQL query for {@link parseDiscussion}; `owner`, `name` and `number` are its variables. */
export const DISCUSSION_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      headRefOid
      comments(first: 100) { totalCount nodes { databaseId author { login } body createdAt } }
      reviews(first: 100) { totalCount nodes { databaseId author { login } body createdAt } }
      reviewThreads(first: 100) {
        totalCount
        nodes {
          isResolved path line diffSide subjectType
          comments(first: 100) { totalCount nodes { databaseId author { login } body createdAt } }
        }
      }
    }
  }
}`

const nodesOf = (value: unknown): unknown[] | null => {
  if (!isPlainObject(value) || !Array.isArray(value['nodes'])) return null
  const nodes: unknown[] = value['nodes']
  return nodes
}

/** How many of a connection's items weren't read: those past its first page. */
const unread = (value: unknown): number => {
  const total = isPlainObject(value) ? value['totalCount'] : null
  const nodes = nodesOf(value)
  return typeof total === 'number' && nodes !== null ? Math.max(0, total - nodes.length) : 0
}

/** A comment node; a deleted account's author is null, which GitHub shows as "ghost". */
function commentOf(value: unknown): DiscussionComment | null {
  if (!isPlainObject(value)) return null
  const { databaseId, author, body, createdAt } = value
  if (typeof databaseId !== 'number' || typeof body !== 'string' || typeof createdAt !== 'string')
    return null
  const login =
    isPlainObject(author) && typeof author['login'] === 'string' ? author['login'] : null
  if (author !== null && login === null) return null
  return { id: databaseId, author: login ?? 'ghost', body, createdAt }
}

function commentsOf(value: unknown): DiscussionComment[] | null {
  const comments = nodesOf(value)?.map(commentOf) ?? null
  return comments?.every((each) => each !== null) ? comments : null
}

/** A thread node, or null when it doesn't have the expected shape; resolved ones are `'resolved'`. */
function threadOf(value: unknown): (ReviewThread & { unread: number }) | 'resolved' | null {
  if (!isPlainObject(value)) return null
  const { isResolved, path, line, diffSide, subjectType } = value
  const comments = commentsOf(value['comments'])
  if (
    typeof isResolved !== 'boolean' ||
    typeof path !== 'string' ||
    path === '' ||
    (line !== null && !(typeof line === 'number' && Number.isInteger(line) && line > 0)) ||
    (diffSide !== 'LEFT' && diffSide !== 'RIGHT') ||
    comments === null
  )
    return null
  if (isResolved) return 'resolved'
  return {
    path,
    side: diffSide === 'LEFT' ? 'old' : 'new',
    line,
    onFile: subjectType === 'FILE',
    comments,
    unread: unread(value['comments'])
  }
}

const hasText = (comment: DiscussionComment) => comment.body.trim() !== ''

/**
 * The discussion in `gh api graphql` output for {@link DISCUSSION_QUERY}, validated as a whole:
 * null when any of it has an unexpected shape. Empty comments (a review submitted without text)
 * are left out.
 */
export function parseDiscussion(json: string): Discussion | null {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    return null
  }
  const data = isPlainObject(value) ? value['data'] : null
  const repository = isPlainObject(data) ? data['repository'] : null
  const pullRequest = isPlainObject(repository) ? repository['pullRequest'] : null
  if (!isPlainObject(pullRequest) || typeof pullRequest['headRefOid'] !== 'string') return null
  const comments = commentsOf(pullRequest['comments'])
  const reviews = commentsOf(pullRequest['reviews'])
  const threads = nodesOf(pullRequest['reviewThreads'])?.map(threadOf) ?? null
  if (comments === null || reviews === null || threads === null) return null
  if (threads.some((thread) => thread === null)) return null
  const open = threads.filter((thread) => thread !== null && thread !== 'resolved')
  return {
    head: pullRequest['headRefOid'],
    threads: open.map(({ unread: _unread, ...thread }) => thread),
    missing:
      unread(pullRequest['comments']) +
      unread(pullRequest['reviews']) +
      unread(pullRequest['reviewThreads']) +
      open.reduce((sum, thread) => sum + thread.unread, 0),
    conversation: [...comments, ...reviews]
      .filter(hasText)
      .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))
  }
}
