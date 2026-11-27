import { create } from 'zustand'
import type { GitGroup } from '@/components/git/change-tree-rows'
import type { StashTarget } from '@/components/git/commit-plan'
import { mainErrorMessage } from '@/lib/main-error-message'
import { useHunkTabStore } from './hunk-tab-store'
import { useSourceControlStore } from './source-control-store'
import type { StashEntry } from '../../../shared/stash-api'

/** The Stash, Unstash or Drop dialog open in the Commit panel. */
export type StashDialog =
  | { kind: 'stash'; target: StashTarget }
  | {
      kind: 'unstash'
      group: GitGroup
      /** Newest first; null while read. */
      stashes: StashEntry[] | null
      /** Why the list couldn't be read. */
      problem: string | null
    }
  | { kind: 'drop'; group: GitGroup; stash: StashEntry }

type StashState = {
  dialog: StashDialog | null
  /** Asks for a message for stashing the target's files. */
  openStash: (target: StashTarget) => void
  /** Lists the working tree's stashes to apply, pop, drop or view. */
  openUnstash: (group: GitGroup) => Promise<void>
  /** Asks to confirm dropping a stash of the open list. */
  openDrop: (stash: StashEntry) => void
  close: () => void
  /** Stashes the Stash dialog's files with the message; they leave the changes, unchecked. */
  stash: (message: string) => Promise<void>
  /** Applies a stash of the open list; `pop` drops it once applied. */
  unstash: (stash: StashEntry, pop: boolean) => Promise<void>
  /** Drops the stash being confirmed, then lists the rest again. */
  drop: () => Promise<void>
  /** Shows a stash of the open list in a hunk tab. */
  view: (stash: StashEntry) => void
}

const git = () => useSourceControlStore.getState()

export const useStashStore = create<StashState>((set, get) => {
  return {
    dialog: null,
    openStash: (target) => set({ dialog: { kind: 'stash', target } }),
    openUnstash: async (group) => {
      const dialog: StashDialog = { kind: 'unstash', group, stashes: null, problem: null }
      set({ dialog })
      let next: StashDialog
      try {
        next = { ...dialog, stashes: await window.desktop.listStashes(group.root) }
      } catch (error) {
        next = { ...dialog, stashes: [], problem: mainErrorMessage(error) }
      }
      // Closed or replaced while it was read.
      if (get().dialog === dialog) set({ dialog: next })
    },
    openDrop: (stash) => {
      const { dialog } = get()
      if (dialog?.kind === 'unstash') set({ dialog: { kind: 'drop', group: dialog.group, stash } })
    },
    close: () => set({ dialog: null }),
    stash: async (message) => {
      const { dialog } = get()
      if (dialog?.kind !== 'stash') return
      const { group, files, untracked } = dialog.target
      set({ dialog: null })
      await git().runGitAction('stash', 'Stash', group, async () => {
        const outcome = await window.desktop.stashChanges({
          root: group.root,
          paths: files.map((file) => file.path),
          untracked: untracked.map((file) => file.path),
          message
        })
        if (outcome.ok) git().forgetChecks(group.root, [...files, ...untracked])
        return outcome
      })
    },
    unstash: async (stash, pop) => {
      const { dialog } = get()
      if (dialog?.kind !== 'unstash') return
      const { group } = dialog
      set({ dialog: null })
      await git().runGitAction('unstash', pop ? 'Pop' : 'Apply', group, () =>
        window.desktop.unstash(group.root, stash.id, pop)
      )
    },
    drop: async () => {
      const { dialog } = get()
      if (dialog?.kind !== 'drop') return
      const { group, stash } = dialog
      set({ dialog: null })
      let dropped = false
      await git().runGitAction('drop-stash', 'Drop', group, async () => {
        const outcome = await window.desktop.dropStash(group.root, stash.id)
        dropped = outcome.ok
        return outcome
      })
      // Back to the list, as it is now, unless another dialog opened meanwhile.
      if (dropped && get().dialog === null) await get().openUnstash(group)
    },
    view: (stash) => {
      const { dialog } = get()
      if (dialog?.kind !== 'unstash') return
      set({ dialog: null })
      useHunkTabStore.getState().open('stash', dialog.group.root, dialog.group.name, stash)
    }
  }
})
