import { create } from 'zustand'
import { mainErrorMessage } from '@/lib/main-error-message'
import type { HunkKind } from '../../../shared/source-control-api'
import type { TerminalSession } from '../../../shared/terminal-api'
import { notify } from './notification-store'

/** hunk starts at this size; its pane resizes it to the real one as soon as it is drawn. */
const STARTING_SIZE = { cols: 120, rows: 32 }

const KIND_LABEL: Record<HunkKind, string> = { review: 'Review', log: 'Log' }

export type HunkTab = {
  id: string
  kind: HunkKind
  root: string
  /** "Review · app": what the strip shows and the tab is named by. */
  title: string
  terminal: TerminalSession
  /** The grid hunk started with, before its pane measured the real one. */
  size: { cols: number; rows: number }
}

type HunkTabState = {
  /** In strip order; not saved: hunk starts again from the Commit panel. */
  tabs: HunkTab[]
  activeTabId: string | null
  /** The last Review or Log found no hunk: the Git view shows how to install it. */
  missing: boolean
  /** (kind, root) pairs whose hunk is starting, so a double click starts one. */
  starting: ReadonlySet<string>
  /** Shows the root's Review or Log tab, starting hunk for it when it has none. */
  open: (kind: HunkKind, root: string, name: string) => Promise<void>
  /** Removes the tab; its hunk ends as the tab unmounts. */
  closeTab: (id: string) => void
  activateTab: (id: string) => void
  dismissMissing: () => void
}

const startKey = (kind: HunkKind, root: string): string => `${kind}\0${root}`

export const useHunkTabStore = create<HunkTabState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  missing: false,
  starting: new Set(),
  open: async (kind, root, name) => {
    const existing = get().tabs.find((tab) => tab.kind === kind && tab.root === root)
    if (existing) {
      set({ activeTabId: existing.id, missing: false })
      return
    }
    const key = startKey(kind, root)
    if (get().starting.has(key)) return
    set((state) => ({ starting: new Set([...state.starting, key]) }))
    try {
      const launch = await window.desktop.launchHunk({ root, kind, ...STARTING_SIZE })
      if (launch.status === 'missing') {
        set({ missing: true })
        return
      }
      const tab: HunkTab = {
        id: crypto.randomUUID(),
        kind,
        root,
        title: `${KIND_LABEL[kind]} · ${name}`,
        terminal: launch.terminal,
        size: STARTING_SIZE
      }
      set((state) => ({ tabs: [...state.tabs, tab], activeTabId: tab.id, missing: false }))
    } catch (error) {
      notify({ severity: 'error', title: "Couldn't start hunk", body: mainErrorMessage(error) })
    } finally {
      set((state) => ({ starting: new Set([...state.starting].filter((each) => each !== key)) }))
    }
  },
  closeTab: (id) =>
    set((state) => {
      const index = state.tabs.findIndex((tab) => tab.id === id)
      if (index === -1) return state
      const tabs = state.tabs.filter((tab) => tab.id !== id)
      // The neighbour to the left takes over, as in browsers and IDEs.
      const neighbour = tabs[Math.max(0, index - 1)]
      return {
        tabs,
        activeTabId: state.activeTabId === id ? (neighbour?.id ?? null) : state.activeTabId
      }
    }),
  activateTab: (id) => set({ activeTabId: id }),
  dismissMissing: () => set({ missing: false })
}))
