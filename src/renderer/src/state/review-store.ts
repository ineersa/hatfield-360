import { create } from 'zustand'
import type { GitGroup } from '@/components/git/change-tree-rows'
import { mainErrorMessage } from '@/lib/main-error-message'
import { useHunkTabStore } from './hunk-tab-store'
import type { BranchList } from '../../../shared/branch-api'
import type { PullRequest, PullRequestList, RepositoryReview } from '../../../shared/review-api'

/** A repository's review targets, as read for one of its branches. */
type ReadReview = RepositoryReview & { branch: string | null }

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
  load: (root: string, branch: string | null) => Promise<void>
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

/** The reads under way, by root and branch: a focus during one doesn't start another. */
const reading = new Set<string>()

export const useReviewStore = create<ReviewState>((set, get) => {
  /** Shows a dialog read in the background, unless it was closed or replaced meanwhile. */
  const settle = (opened: ReviewDialog, next: ReviewDialog): void => {
    if (get().dialog === opened) set({ dialog: next })
  }
  return {
    reviews: {},
    dialog: null,
    load: async (root, branch) => {
      const key = `${root}\0${branch ?? ''}`
      if (reading.has(key)) return
      reading.add(key)
      try {
        const review = await window.desktop.repositoryReview(root)
        set((state) => ({ reviews: { ...state.reviews, [root]: { ...review, branch } } }))
      } catch (error) {
        // Without them the Commit panel offers what it can: Review Branch needs a base it can't name.
        console.error(`Reading ${root}'s review targets failed:`, error)
      } finally {
        reading.delete(key)
      }
    },
    reviewBranch: (group, base) => {
      const target = base ?? get().reviews[group.root]?.base
      if (!target) return
      set({ dialog: null })
      useHunkTabStore.getState().open('branch', group.root, group.name, {
        id: target,
        label: `${group.branch ?? 'HEAD'} vs ${target}`
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
