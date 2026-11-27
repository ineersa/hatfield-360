import { create } from 'zustand'
import { mainErrorMessage } from '@/lib/main-error-message'
import type { HunkKind } from '../../../shared/source-control-api'
import { notify } from './notification-store'

/** One hunk run in a tab: its pane starts hunk itself, so a remounted pane starts a fresh one. */
export type HunkTab = {
  id: string
  kind: HunkKind
  root: string
  /** "Review · app": what the strip shows and the tab is named by. */
  title: string
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
  /** Shows the root's Review or Log tab, opening one (shown once hunk runs) when it has none. */
  open: (kind: HunkKind, root: string, name: string) => void
  /** hunk runs in the tab: the strip shows it, chosen. */
  started: (id: string) => void
  /** No hunk on the user's PATH: the tab goes and the install steps show. */
  hunkMissing: (id: string) => void
  /** hunk couldn't be started: the tab goes and the reason is a notification. */
  startFailed: (id: string, error: unknown) => void
  /** Removes the tab; its hunk ends as the tab unmounts. */
  closeTab: (id: string) => void
  activateTab: (id: string) => void
  dismissMissing: () => void
}

const KIND_LABEL: Record<HunkKind, string> = { review: 'Review', log: 'Log' }

/** The root's Review or Log tab, if one is open or opening. */
export function tabFor(
  tabs: readonly HunkTab[],
  kind: HunkKind,
  root: string
): HunkTab | undefined {
  return tabs.find((tab) => tab.kind === kind && tab.root === root)
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
    open: (kind, root, name) => {
      const { tabs, pending } = get()
      const existing = tabFor(tabs, kind, root)
      if (existing) {
        // One still starting is chosen once hunk runs.
        if (!pending.has(existing.id)) set({ activeTabId: existing.id, missing: false })
        return
      }
      const tab: HunkTab = {
        id: crypto.randomUUID(),
        kind,
        root,
        title: `${KIND_LABEL[kind]} · ${name}`
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
    activateTab: (id) => set({ activeTabId: id }),
    dismissMissing: () => set({ missing: false })
  }
})
