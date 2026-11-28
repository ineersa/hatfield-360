import type { PullRequestComments, PullRequestPublish } from '../../shared/source-control-api'
import { postToPullRequest, readDiscussion } from '../git/pull-request-comments'
import { hunkSessionIn, listHunkNotes, runHunk } from './hunk-notes'
import {
  type ApplyItem,
  appliedIds,
  conversationRoot,
  firstFile,
  type LoadedNote,
  parseNoteList,
  publishPlan,
  replyTo,
  threadRoot
} from './hunk-pull-request-notes'

/** How long a pull request tab's hunk is waited for: it downloads the pull request first. */
const SESSION_WAIT_MS = 120_000
const SESSION_POLL_MS = 500

const failed = (message: string): PullRequestPublish => ({
  status: 'failed',
  message,
  posted: 0,
  comments: null
})

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * A pull request tab's hunk and the pull request's GitHub discussion: loads the unresolved threads
 * and conversation into hunk, and publishes the user's notes back. One operation at a time.
 */
export class PullRequestNotes {
  /** Notes Hatfield put in hunk, by hunk note id: what each stands for on GitHub. */
  private readonly loaded = new Map<string, LoadedNote>()
  /** The head commit the loaded threads' lines refer to. */
  private head: string | null = null
  private session: string | null = null
  private stopped = false
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly hunk: string,
    private readonly terminalPid: number,
    private readonly root: string,
    private readonly number: string
  ) {}

  /** hunk ended: nothing more is waited for. */
  stop(): void {
    this.stopped = true
  }

  /** Loads the pull request's discussion into hunk, in place of what was loaded before. */
  load(): Promise<PullRequestComments> {
    return this.serially(() => this.loadNow())
  }

  /** Posts the user's notes to the pull request, takes them out of hunk and loads it afresh. */
  publish(): Promise<PullRequestPublish> {
    return this.serially(() => this.publishNow())
  }

  private serially<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work)
    this.queue = next.catch(() => undefined)
    return next
  }

  private async sessionNow(): Promise<string | null> {
    const deadline = Date.now() + SESSION_WAIT_MS
    while (this.session === null && !this.stopped && Date.now() < deadline) {
      this.session = await hunkSessionIn(this.hunk, this.terminalPid)
      if (this.session === null) await delay(SESSION_POLL_MS)
    }
    return this.session
  }

  private hunkSession(args: string[], stdin?: string): Promise<string | null> {
    return runHunk(this.hunk, ['session', ...args], stdin)
  }

  /** Adds notes to hunk: one batch, or one at a time when hunk refuses the batch (a line it can't place). */
  private async apply(session: string, items: readonly ApplyItem[]): Promise<(string | null)[]> {
    if (items.length === 0) return []
    const run = (batch: readonly ApplyItem[]) =>
      this.hunkSession(
        ['comment', 'apply', session, '--stdin', '--json'],
        JSON.stringify({ comments: batch })
      ).then((output) => (output === null ? null : appliedIds(output)))
    const all = await run(items)
    if (all !== null && all.length === items.length) return all
    const each: (string | null)[] = []
    for (const item of items) each.push((await run([item]))?.[0] ?? null)
    return each
  }

  private async loadNow(): Promise<PullRequestComments> {
    const session = await this.sessionNow()
    if (session === null) return { status: 'failed', message: 'hunk has not started.' }
    const discussion = await readDiscussion(this.root, this.number)
    if (typeof discussion === 'string') return { status: 'failed', message: discussion }
    // Newest first: hunk won't remove a note while it has replies, and replies were added last.
    for (const noteId of [...this.loaded.keys()].toReversed())
      await this.hunkSession(['comment', 'rm', session, noteId])
    this.loaded.clear()
    this.head = discussion.head
    const files = await this.hunkSession(['get', session, '--json'])
    const first = files === null ? null : firstFile(files)

    const threads = discussion.threads.flatMap((thread) => {
      const root = threadRoot(thread)
      return root === null ? [] : [{ thread, root }]
    })
    const conversation = first === null ? [] : discussion.conversation
    const roots = await this.apply(session, [
      ...threads.map(({ root }) => root),
      ...conversation.map((comment) => conversationRoot(comment, first ?? ''))
    ])
    const replies: { item: ApplyItem; commentId: number }[] = []
    let shownThreads = 0
    threads.forEach(({ thread }, index) => {
      const noteId = roots[index]
      const [rootComment, ...rest] = thread.comments
      if (noteId === undefined || noteId === null || rootComment === undefined) return
      shownThreads += 1
      this.loaded.set(noteId, { kind: 'thread', commentId: rootComment.id })
      for (const comment of rest)
        replies.push({ item: replyTo(noteId, comment), commentId: rootComment.id })
    })
    let shownConversation = 0
    conversation.forEach((comment, index) => {
      const noteId = roots[threads.length + index]
      if (noteId === undefined || noteId === null) return
      shownConversation += 1
      this.loaded.set(noteId, { kind: 'conversation', author: comment.author, body: comment.body })
    })
    // A reply is a reply, kept in hunk even when hunk can't show the thread's other replies.
    const replyIds = await this.apply(
      session,
      replies.map(({ item }) => item)
    )
    replies.forEach(({ commentId }, index) => {
      const noteId = replyIds[index]
      if (noteId !== undefined && noteId !== null)
        this.loaded.set(noteId, { kind: 'thread', commentId })
    })
    return {
      status: 'loaded',
      threads: shownThreads,
      conversation: shownConversation,
      notShown:
        discussion.threads.length -
        shownThreads +
        discussion.conversation.length -
        shownConversation
    }
  }

  private async publishNow(): Promise<PullRequestPublish> {
    const session = await this.sessionNow()
    if (session === null) return failed('hunk has not started.')
    if (this.head === null)
      return failed('The pull request’s comments haven’t loaded: Reload, then publish.')
    const listed = await listHunkNotes(this.hunk, session, 'all')
    const notes = listed === null ? null : parseNoteList(listed)
    if (notes === null) return failed('hunk did not list its notes.')
    const plan = publishPlan(notes, this.loaded)
    const posts = plan.review.length + plan.replies.length + plan.conversation.length
    if (posts === 0) return { status: 'nothing', unplaced: plan.unplaced }

    const posted: string[] = []
    const failures: string[] = []
    const post = async (
      noteIds: string[],
      path: (repository: string) => string,
      fields: object
    ) => {
      const failure = await postToPullRequest(this.root, path, fields)
      if (failure === null) posted.push(...noteIds)
      else failures.push(failure)
    }
    const pulls = (repository: string) => `${repository}/pulls/${this.number}`
    if (plan.review.length > 0)
      await post(
        plan.review.flatMap((each) => each.noteIds),
        (repository) => `${pulls(repository)}/reviews`,
        { commit_id: this.head, event: 'COMMENT', comments: plan.review.map((each) => each.post) }
      )
    for (const reply of plan.replies)
      await post(
        reply.noteIds,
        (repository) => `${pulls(repository)}/comments/${reply.post.commentId}/replies`,
        { body: reply.post.body }
      )
    for (const comment of plan.conversation)
      await post(comment.noteIds, (repository) => `${repository}/issues/${this.number}/comments`, {
        body: comment.post
      })
    // Replies first: hunk won't remove a note while it has replies.
    for (const noteId of posted.toReversed())
      await this.hunkSession(['comment', 'rm', session, noteId])
    const comments = await this.loadNow()
    const count = posts - failures.length
    return failures.length === 0
      ? { status: 'published', posted: count, unplaced: plan.unplaced, comments }
      : { status: 'failed', message: failures.join(' '), posted: count, comments }
  }
}
