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
  /** What makes two tabs of a kind and root the same: the target, or more (a branch review's branch). */
  key: string | null
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
  /** Tabs being closed whose hunk holds review notes, waiting on the user to close them anyway. */
  withNotes: { ids: string[]; count: number } | null
  /**
   * Shows the root's tab of that kind and target, opening one (shown once hunk runs) when there is
   * none. `target.label` ends the tab's title.
   */
  open: (
    kind: HunkKind,
    root: string,
    name: string,
    target?: { id: string; label: string; key?: string }
  ) => void
  /** hunk runs in the tab: the strip shows it, chosen. */
  started: (id: string) => void
  /** No hunk on the user's PATH: the tab goes and the install steps show. */
  hunkMissing: (id: string) => void
  /** hunk couldn't be started: the tab goes and the reason is a notification. */
  startFailed: (id: string, error: unknown) => void
  /** Removes the tab; its hunk ends as the tab unmounts, and its review notes with it. */
  closeTab: (id: string) => void
  /** The terminal a tab's hunk runs in, once started. */
  attachTerminal: (id: string, terminalId: string) => void
  /**
   * The user closes tabs: those whose hunk holds notes wait for `withNotes` to be answered, as
   * hunk keeps notes only while it runs; the rest close.
   */
  requestClose: (ids: readonly string[]) => Promise<void>
  /** Closes the tabs that hold notes (or keeps them, with `close: false`). */
  settleNotes: (close: boolean) => void
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

/** The root's tab of that kind and key (its target, unless it was opened with one), if one is open or opening. */
export function tabFor(
  tabs: readonly HunkTab[],
  kind: HunkKind,
  root: string,
  key: string | null = null
): HunkTab | undefined {
  return tabs.find((tab) => tab.kind === kind && tab.root === root && tab.key === key)
}

/** By tab id: the terminal its hunk runs in. Not state: nothing is drawn from it. */
const terminals = new Map<string, string>()

/** The terminal a tab's hunk runs in, once started. */
export const hunkTerminalOf = (id: string): string | undefined => terminals.get(id)

/** The notes a tab's hunk holds; 0 when it can't say, so the tab closes as before. */
async function notesIn(id: string): Promise<number> {
  const terminalId = terminals.get(id)
  if (terminalId === undefined) return 0
  return window.desktop.hunkNoteCount(terminalId).catch(() => 0)
}

const without = (set: ReadonlySet<string>, id: string): ReadonlySet<string> =>
  new Set([...set].filter((each) => each !== id))

export const useHunkTabStore = create<HunkTabState>((set, get) => {
  const remove = (id: string): void => {
    terminals.delete(id)
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
  }
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
    withNotes: null,
    open: (kind, root, name, target) => {
      const { tabs, pending } = get()
      const key = target?.key ?? target?.id ?? null
      const existing = tabFor(tabs, kind, root, key)
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
        key,
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
    attachTerminal: (id, terminalId) => terminals.set(id, terminalId),
    requestClose: async (ids) => {
      const counts = await Promise.all(ids.map(notesIn))
      const kept = ids.filter((_id, index) => (counts[index] ?? 0) > 0)
      for (const id of ids) if (!kept.includes(id)) remove(id)
      if (kept.length > 0)
        set({ withNotes: { ids: kept, count: counts.reduce((sum, count) => sum + count, 0) } })
    },
    settleNotes: (close) => {
      const ids = get().withNotes?.ids ?? []
      set({ withNotes: null })
      if (close) for (const id of ids) remove(id)
    },
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
