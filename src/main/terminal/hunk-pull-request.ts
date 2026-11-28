import type { PullRequestComments, PullRequestPublish } from '../../shared/source-control-api'
import { postToPullRequest, readDiscussion } from '../git/pull-request-comments'
import type { Discussion, DiscussionComment } from '../git/pull-request-discussion'
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
  /** The head commit the loaded threads' lines refer to: hunk's diff, downloaded at launch. */
  private head: string | null = null
  /** The user's notes already posted, which hunk may keep when they have replies. */
  private readonly published = new Set<string>()
  private session: string | null = null
  private stopped = false
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly hunk: string,
    private readonly terminalPid: number,
    private readonly root: string,
    private readonly number: string
  ) {}

  /** hunk ended: nothing more is waited for or run. */
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

  /**
   * Adds notes to hunk: one batch, or one at a time when hunk refuses it (a line it can't place).
   * Notes of a batch hunk took only part of are taken back first, so none is added twice.
   */
  private async apply(session: string, items: readonly ApplyItem[]): Promise<(string | null)[]> {
    if (items.length === 0) return []
    const run = (batch: readonly ApplyItem[]) =>
      this.hunkSession(
        ['comment', 'apply', session, '--stdin', '--json'],
        JSON.stringify({ comments: batch })
      ).then((output) => (output === null ? null : appliedIds(output)))
    const all = await run(items)
    if (all !== null && all.length === items.length) return all
    for (const noteId of (all ?? []).toReversed()) await this.remove(session, noteId)
    const each: (string | null)[] = []
    for (const item of items) each.push((await run([item]))?.[0] ?? null)
    return each
  }

  /** Takes a note out of hunk; false when hunk keeps it (it won't remove one that has replies). */
  private async remove(session: string, noteId: string): Promise<boolean> {
    return (await this.hunkSession(['comment', 'rm', session, noteId])) !== null
  }

  /** The pull request's discussion, unless it has commits the tab's hunk doesn't show. */
  private async discussion(): Promise<Discussion | string> {
    const discussion = await readDiscussion(this.root, this.number)
    if (typeof discussion === 'string') return discussion
    // hunk shows the diff it downloaded: lines of a later head would land on the wrong rows.
    if (this.head !== null && discussion.head !== this.head)
      return `#${this.number} has new commits since this tab opened. Close the tab and open it again to see them.`
    return discussion
  }

  private async loadNow(): Promise<PullRequestComments> {
    if (this.stopped) return { status: 'failed', message: 'hunk has ended.' }
    const session = await this.sessionNow()
    if (session === null) return { status: 'failed', message: 'hunk has not started.' }
    const discussion = await this.discussion()
    if (typeof discussion === 'string') return { status: 'failed', message: discussion }
    this.head = discussion.head

    // Newest first, as replies were added last. A note the user has replied to stays, and stands
    // for its GitHub comment, so the reply is still published into its thread.
    const kept = new Map<number, string>()
    for (const [noteId, note] of [...this.loaded].toReversed()) {
      if (await this.remove(session, noteId)) this.loaded.delete(noteId)
      else kept.set(note.githubId, noteId)
    }
    const files = await this.hunkSession(['get', session, '--json'])
    const first = files === null ? null : firstFile(files)

    type Root = {
      kind: 'threads' | 'conversation'
      item: ApplyItem
      loaded: (noteId: string) => void
    }
    const roots: Root[] = []
    const replies: { comment: DiscussionComment; rootId: number; under: () => string | null }[] = []
    let shown = { threads: 0, conversation: 0 }
    let unplaced = discussion.missing
    for (const thread of discussion.threads) {
      const [rootComment, ...rest] = thread.comments
      if (rootComment === undefined) continue
      let rootNote = kept.get(rootComment.id) ?? null
      const item = rootNote === null ? threadRoot(thread) : null
      if (rootNote === null && item === null) {
        unplaced += 1
        continue
      }
      if (item !== null)
        roots.push({
          kind: 'threads',
          item,
          loaded: (noteId) => {
            rootNote = noteId
            this.loaded.set(noteId, {
              kind: 'thread',
              commentId: rootComment.id,
              githubId: rootComment.id
            })
          }
        })
      shown = { ...shown, threads: shown.threads + 1 }
      for (const comment of rest)
        if (!kept.has(comment.id))
          replies.push({ comment, rootId: rootComment.id, under: () => rootNote })
    }
    for (const comment of discussion.conversation) {
      if (kept.has(comment.id)) {
        shown = { ...shown, conversation: shown.conversation + 1 }
        continue
      }
      if (first === null) {
        unplaced += 1
        continue
      }
      roots.push({
        kind: 'conversation',
        item: conversationRoot(comment, first),
        loaded: (noteId) =>
          this.loaded.set(noteId, {
            kind: 'conversation',
            author: comment.author,
            body: comment.body,
            githubId: comment.id
          })
      })
      shown = { ...shown, conversation: shown.conversation + 1 }
    }

    const rootIds = await this.apply(
      session,
      roots.map(({ item }) => item)
    )
    roots.forEach((root, index) => {
      const noteId = rootIds[index]
      if (noteId !== undefined && noteId !== null) root.loaded(noteId)
      else {
        unplaced += 1
        shown = { ...shown, [root.kind]: shown[root.kind] - 1 }
      }
    })
    // A reply goes under its thread's note in hunk; a thread hunk couldn't place takes its replies.
    const placed = replies.flatMap(({ comment, rootId, under }) => {
      const noteId = under()
      return noteId === null ? [] : [{ comment, rootId, item: replyTo(noteId, comment) }]
    })
    const replyIds = await this.apply(
      session,
      placed.map(({ item }) => item)
    )
    placed.forEach(({ comment, rootId }, index) => {
      const noteId = replyIds[index]
      if (noteId !== undefined && noteId !== null)
        this.loaded.set(noteId, { kind: 'thread', commentId: rootId, githubId: comment.id })
    })
    return { status: 'loaded', ...shown, notShown: unplaced }
  }

  /** How many of the user's notes aren't on GitHub: what closing the tab would lose. */
  async unpublished(): Promise<number> {
    const session = this.stopped ? null : await hunkSessionIn(this.hunk, this.terminalPid)
    const listed = session === null ? null : await listHunkNotes(this.hunk, session, 'user')
    const notes = listed === null ? null : parseNoteList(listed)
    return (
      notes?.filter((note) => !this.published.has(note.noteId) && !this.loaded.has(note.noteId))
        .length ?? 0
    )
  }

  private async publishNow(): Promise<PullRequestPublish> {
    if (this.stopped) return failed('hunk has ended.')
    const session = await this.sessionNow()
    if (session === null) return failed('hunk has not started.')
    if (this.head === null)
      return failed('The pull request’s comments haven’t loaded: Reload, then publish.')
    const listed = await listHunkNotes(this.hunk, session, 'all')
    const notes = listed === null ? null : parseNoteList(listed)
    if (notes === null) return failed('hunk did not list its notes.')
    const plan = publishPlan(notes, this.loaded, this.published)
    const posts = plan.review.length + plan.replies.length + plan.conversation.length
    if (posts === 0) return { status: 'nothing', unplaced: plan.unplaced }
    const current = await this.discussion()
    if (typeof current === 'string') return failed(current)

    const posted: string[] = []
    const failures: string[] = []
    let count = 0
    const post = async (
      planned: { noteIds: string[] }[],
      path: (repository: string) => string,
      fields: object
    ) => {
      const failure = await postToPullRequest(this.root, path, fields)
      if (failure !== null) {
        failures.push(failure)
        return
      }
      count += planned.length
      for (const each of planned) posted.push(...each.noteIds)
    }
    const pulls = (repository: string) => `${repository}/pulls/${this.number}`
    if (plan.review.length > 0)
      await post(plan.review, (repository) => `${pulls(repository)}/reviews`, {
        commit_id: this.head,
        event: 'COMMENT',
        comments: plan.review.map((each) => each.post)
      })
    for (const reply of plan.replies)
      await post(
        [reply],
        (repository) => `${pulls(repository)}/comments/${reply.post.commentId}/replies`,
        { body: reply.post.body }
      )
    for (const comment of plan.conversation)
      await post([comment], (repository) => `${repository}/issues/${this.number}/comments`, {
        body: comment.post
      })
    // Never posted twice, even when hunk keeps the note (someone replied to it). Replies first:
    // hunk won't remove a note while it has replies.
    for (const noteId of posted.toReversed()) {
      this.published.add(noteId)
      await this.remove(session, noteId)
    }
    const comments = await this.loadNow()
    return failures.length === 0
      ? { status: 'published', posted: count, unplaced: plan.unplaced, comments }
      : { status: 'failed', message: failures.join(' '), posted: count, comments }
  }
}
