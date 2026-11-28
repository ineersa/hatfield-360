import { create } from 'zustand'
import { mainErrorMessage } from '@/lib/main-error-message'
import type { HunkKind } from '../../../shared/source-control-api'
import { notify } from './notification-store'

/** One hunk run in a tab: its pane starts hunk itself, so a remounted pane starts a fresh one. */
export type HunkTab = {
  id: string
  kind: HunkKind
  root: string
  /** The stash, base branch or pull request number a `stash`, `branch` or `pull-request` tab shows; null for the others. */
  target: string | null
  /** "Review · app": what the strip shows and the tab is named by. */
  title: string
  /** Counts restarts: a new value remounts the pane, which starts hunk afresh. */
  run: number
}

type HunkTabState = {
  /** In strip order, started or not; not saved: hunk starts again from the Commit panel. */
  tabs: HunkTab[]
  /** Tabs whose hunk hasn't started yet: laid out out of sight, so it starts at the real size. */
  pending: ReadonlySet<string>
  /** Always a started tab. */
  activeTabId: string | null
  /** The last launch found no hunk: the Git view shows how to install it. */
  missing: boolean
  /**
   * Shows the root's tab of that kind and target, opening one (shown once hunk runs) when there is
   * none. `target.label` ends the tab's title.
   */
  open: (kind: HunkKind, root: string, name: string, target?: { id: string; label: string }) => void
  /** hunk runs in the tab: the strip shows it, chosen. */
  started: (id: string) => void
  /** No hunk on the user's PATH: the tab goes and the install steps show. */
  hunkMissing: (id: string) => void
  /** hunk couldn't be started: the tab goes and the reason is a notification. */
  startFailed: (id: string, error: unknown) => void
  /** Removes the tab; its hunk ends as the tab unmounts. */
  closeTab: (id: string) => void
  /**
   * Starts the root's Log tab's hunk afresh, in place: `hunk log` reads the history once, so a
   * commit, pull, switch or other ref change would otherwise not show. Review watches on its own.
   */
  reloadLog: (root: string) => void
  activateTab: (id: string) => void
  dismissMissing: () => void
}

const KIND_LABEL: Record<HunkKind, string> = {
  review: 'Review',
  log: 'Log',
  stash: 'Stash',
  branch: 'Branch',
  'pull-request': 'Pull Request'
}

/** The root's tab of that kind and target, if one is open or opening. */
export function tabFor(
  tabs: readonly HunkTab[],
  kind: HunkKind,
  root: string,
  target: string | null = null
): HunkTab | undefined {
  return tabs.find((tab) => tab.kind === kind && tab.root === root && tab.target === target)
}

const without = (set: ReadonlySet<string>, id: string): ReadonlySet<string> =>
  new Set([...set].filter((each) => each !== id))

export const useHunkTabStore = create<HunkTabState>((set, get) => {
  const remove = (id: string): void =>
    set((state) => {
      const index = state.tabs.findIndex((tab) => tab.id === id)
      if (index === -1) return state
      const tabs = state.tabs.filter((tab) => tab.id !== id)
      const pending = without(state.pending, id)
      // The started neighbour to the left takes over, as in browsers and IDEs.
      const shown = (list: HunkTab[]) => list.filter((tab) => !pending.has(tab.id))
      const neighbour = shown(state.tabs.slice(0, index)).at(-1) ?? shown(tabs)[0]
      return {
        tabs,
        pending,
        activeTabId: state.activeTabId === id ? (neighbour?.id ?? null) : state.activeTabId
      }
    })
  const removeIfOpen = (id: string): boolean => {
    if (!get().tabs.some((tab) => tab.id === id)) return false
    remove(id)
    return true
  }
  return {
    tabs: [],
    pending: new Set(),
    activeTabId: null,
    missing: false,
    open: (kind, root, name, target) => {
      const { tabs, pending } = get()
      const existing = tabFor(tabs, kind, root, target?.id ?? null)
      if (existing) {
        // One still starting is chosen once hunk runs.
        if (!pending.has(existing.id)) set({ activeTabId: existing.id, missing: false })
        return
      }
      const tab: HunkTab = {
        id: crypto.randomUUID(),
        kind,
        root,
        target: target?.id ?? null,
        title: [KIND_LABEL[kind], name, ...(target ? [target.label] : [])].join(' · '),
        run: 0
      }
      set((state) => ({ tabs: [...state.tabs, tab], pending: new Set([...state.pending, tab.id]) }))
    },
    started: (id) =>
      set((state) =>
        state.pending.has(id)
          ? { pending: without(state.pending, id), activeTabId: id, missing: false }
          : state
      ),
    hunkMissing: (id) => {
      if (removeIfOpen(id)) set({ missing: true })
    },
    startFailed: (id, error) => {
      if (removeIfOpen(id))
        notify({ severity: 'error', title: "Couldn't start hunk", body: mainErrorMessage(error) })
    },
    closeTab: remove,
    reloadLog: (root) =>
      set((state) => {
        const tab = tabFor(state.tabs, 'log', root)
        // One still starting reads the history as it is now.
        if (tab === undefined || state.pending.has(tab.id)) return state
        return {
          tabs: state.tabs.map((each) => (each === tab ? { ...tab, run: tab.run + 1 } : each))
        }
      }),
    activateTab: (id) => set({ activeTabId: id }),
    dismissMissing: () => set({ missing: false })
  }
})
