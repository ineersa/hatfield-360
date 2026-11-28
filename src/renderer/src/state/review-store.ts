import { create } from 'zustand'
import type { GitGroup } from '@/components/git/change-tree-rows'
import { mainErrorMessage } from '@/lib/main-error-message'
import { useHunkTabStore } from './hunk-tab-store'
import type { BranchList } from '../../../shared/branch-api'
import type { PullRequest, PullRequestList, RepositoryReview } from '../../../shared/review-api'

/** A repository's review targets, as read for one of its branches; `problem` when reading failed. */
type ReadReview = RepositoryReview & { branch: string | null; problem: string | null }

/** The review read for the group's current branch, or undefined while that one is being read. */
export function reviewOf(
  reviews: Readonly<Record<string, ReadReview>>,
  group: { root: string; branch?: string | null }
): ReadReview | undefined {
  const review = reviews[group.root]
  return review !== undefined && review.branch === (group.branch ?? null) ? review : undefined
}

/** Focus reads a repository again at most this often; a branch change reads it at once. */
const FOCUS_READ_INTERVAL_MS = 30_000

/** The base chooser or pull request list open in the Commit panel. */
export type ReviewDialog =
  | {
      kind: 'base'
      group: GitGroup
      /** Null while read. */
      branches: BranchList | null
      problem: string | null
    }
  | {
      kind: 'pull-requests'
      group: GitGroup
      /** Null while read. */
      list: PullRequestList | null
    }

type ReviewState = {
  /** By root: read when the repository's branch changes and when the window gets focus. */
  reviews: Readonly<Record<string, ReadReview>>
  dialog: ReviewDialog | null
  /** Reads the repository's review base, GitHub remote and current pull request. */
  load: (root: string, branch: string | null, options?: { focus?: boolean }) => Promise<void>
  /** Forgets the reviews of repositories no longer shown. */
  keepOnly: (roots: readonly string[]) => void
  /** Opens the branch's commits since `base` (else the default base) in a hunk tab. */
  reviewBranch: (group: GitGroup, base?: string) => void
  /** Lists the branches to review the current one against. */
  openBaseChooser: (group: GitGroup) => Promise<void>
  /** Lists the repository's open pull requests. */
  openPullRequests: (group: GitGroup) => Promise<void>
  /** Opens the pull request in a hunk tab. */
  reviewPullRequest: (group: GitGroup, pullRequest: Pick<PullRequest, 'number' | 'title'>) => void
  close: () => void
}

/** The latest read asked for, by root: an older one finishing later is dropped. */
const latest = new Map<string, { branch: string | null; at: number; done: boolean }>()

export const useReviewStore = create<ReviewState>((set, get) => {
  /** Shows a dialog read in the background, unless it was closed or replaced meanwhile. */
  const settle = (opened: ReviewDialog, next: ReviewDialog): void => {
    if (get().dialog === opened) set({ dialog: next })
  }
  return {
    reviews: {},
    dialog: null,
    load: async (root, branch, options) => {
      const previous = latest.get(root)
      if (previous?.branch === branch) {
        // The same branch: one read at a time, and focus only now and then.
        if (!previous.done) return
        if (options?.focus && Date.now() - previous.at < FOCUS_READ_INTERVAL_MS) return
      }
      const read = { branch, at: Date.now(), done: false }
      latest.set(root, read)
      let next: ReadReview
      try {
        next = { ...(await window.desktop.repositoryReview(root)), branch, problem: null }
      } catch (error) {
        console.error(`Reading ${root}'s review targets failed:`, error)
        next = {
          base: null,
          github: null,
          pullRequest: null,
          branch,
          problem: mainErrorMessage(error)
        }
      }
      read.done = true
      if (latest.get(root) === read)
        set((state) => ({ reviews: { ...state.reviews, [root]: next } }))
    },
    keepOnly: (roots) => {
      const kept = new Set(roots)
      for (const root of latest.keys()) if (!kept.has(root)) latest.delete(root)
      set((state) => ({
        reviews: Object.fromEntries(
          Object.entries(state.reviews).filter(([root]) => kept.has(root))
        )
      }))
    },
    reviewBranch: (group, base) => {
      const target = base ?? reviewOf(get().reviews, group)?.base
      if (!target) return
      set({ dialog: null })
      const branch = group.branch ?? 'HEAD'
      // Another branch against the same base is another review.
      useHunkTabStore.getState().open('branch', group.root, group.name, {
        id: target,
        label: `${branch} vs ${target}`,
        key: `${branch}\0${target}`
      })
    },
    openBaseChooser: async (group) => {
      const opened: ReviewDialog = { kind: 'base', group, branches: null, problem: null }
      set({ dialog: opened })
      try {
        settle(opened, { ...opened, branches: await window.desktop.listBranches(group.root) })
      } catch (error) {
        settle(opened, {
          ...opened,
          branches: { current: null, head: null, local: [], remote: [] },
          problem: mainErrorMessage(error)
        })
      }
    },
    openPullRequests: async (group) => {
      const opened: ReviewDialog = { kind: 'pull-requests', group, list: null }
      set({ dialog: opened })
      try {
        settle(opened, { ...opened, list: await window.desktop.listPullRequests(group.root) })
      } catch (error) {
        settle(opened, { ...opened, list: { status: 'failed', output: mainErrorMessage(error) } })
      }
    },
    reviewPullRequest: (group, pullRequest) => {
      set({ dialog: null })
      useHunkTabStore.getState().open('pull-request', group.root, group.name, {
        id: String(pullRequest.number),
        label: `#${pullRequest.number} ${pullRequest.title}`
      })
    },
    close: () => set({ dialog: null })
  }
})
