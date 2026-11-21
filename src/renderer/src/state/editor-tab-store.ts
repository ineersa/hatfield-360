import { create } from 'zustand'

type EditorTabLoad =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'error'; message: string }

export type EditorTab = {
  path: string
  load: EditorTabLoad
  /** Edited since it was opened or last saved. */
  dirty: boolean
}

type EditorTabState = {
  /** In tab-bar order. */
  tabs: EditorTab[]
  activePath: string | null
  /** Opens a tab for the file, or switches to it if it is already open. */
  open: (path: string) => void
  activate: (path: string) => void
  /** Moves a tab to another tab's place in the bar. */
  move: (path: string, before: string) => void
  /** Closes the tab, dropping unsaved changes; the neighbour to its right becomes active. */
  close: (path: string) => void
  setLoad: (path: string, load: EditorTabLoad) => void
  setDirty: (path: string, dirty: boolean) => void
}

const update = (tabs: EditorTab[], path: string, change: Partial<EditorTab>): EditorTab[] =>
  tabs.map((tab) => (tab.path === path ? { ...tab, ...change } : tab))

export const useEditorTabStore = create<EditorTabState>((set) => ({
  tabs: [],
  activePath: null,
  open: (path) =>
    set((state) => ({
      tabs: state.tabs.some((tab) => tab.path === path)
        ? state.tabs
        : [...state.tabs, { path, load: { status: 'loading' }, dirty: false }],
      activePath: path
    })),
  activate: (path) => set({ activePath: path }),
  move: (path, before) =>
    set((state) => {
      const from = state.tabs.findIndex((tab) => tab.path === path)
      const to = state.tabs.findIndex((tab) => tab.path === before)
      const moved = state.tabs[from]
      if (!moved || to === -1 || from === to) return state
      const tabs = state.tabs.filter((tab) => tab.path !== path)
      tabs.splice(to, 0, moved)
      return { tabs }
    }),
  close: (path) =>
    set((state) => {
      const index = state.tabs.findIndex((tab) => tab.path === path)
      if (index === -1) return state
      const tabs = state.tabs.filter((tab) => tab.path !== path)
      const activePath =
        state.activePath === path
          ? (tabs[Math.min(index, tabs.length - 1)]?.path ?? null)
          : state.activePath
      return { tabs, activePath }
    }),
  setLoad: (path, load) => set((state) => ({ tabs: update(state.tabs, path, { load }) })),
  setDirty: (path, dirty) => set((state) => ({ tabs: update(state.tabs, path, { dirty }) }))
}))
