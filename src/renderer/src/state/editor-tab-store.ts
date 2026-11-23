import { create } from 'zustand'

type EditorTabLoad =
  | { status: 'loading' }
  /** `large` shows the file's start, read-only; `binary` shows nothing. */
  /** `outside`: a file outside the workspace, read-only. */
  | { status: 'ready'; file: 'text' | 'large' | 'binary'; size: number; outside?: true }
  | { status: 'error'; message: string }

/**
 * The file on disk differs from the tab's text and the tab has unsaved edits: `disk` when that was
 * seen on disk, `save` when a save found it. The user picks which version stays.
 */
type EditorTabConflict = 'disk' | 'save'

export type EditorTab = {
  path: string
  load: EditorTabLoad
  /** Edited since it was opened or last saved. */
  dirty: boolean
  /** Deleted or renamed away on disk; saving creates it again. */
  deleted: boolean
  conflict: EditorTabConflict | null
  /** A Markdown tab shows its rendered preview instead of the source. */
  preview: boolean
}

const newTab = (path: string): EditorTab => ({
  path,
  load: { status: 'loading' },
  dirty: false,
  deleted: false,
  conflict: null,
  preview: false
})

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
  setDeleted: (path: string, deleted: boolean) => void
  setConflict: (path: string, conflict: EditorTabConflict | null) => void
  togglePreview: (path: string) => void
  /** Puts back a workspace's saved tabs in place of the open ones; tabs with unsaved changes stay. */
  restore: (paths: string[], activePath: string | null) => void
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
        : [...state.tabs, newTab(path)],
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
  setDirty: (path, dirty) => set((state) => ({ tabs: update(state.tabs, path, { dirty }) })),
  setDeleted: (path, deleted) => set((state) => ({ tabs: update(state.tabs, path, { deleted }) })),
  setConflict: (path, conflict) =>
    set((state) => ({ tabs: update(state.tabs, path, { conflict }) })),
  togglePreview: (path) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.path === path ? { ...tab, preview: !tab.preview } : tab))
    })),
  restore: (paths, activePath) =>
    set((state) => {
      const restored = [...new Set(paths)].map(
        (path): EditorTab => state.tabs.find((tab) => tab.path === path) ?? newTab(path)
      )
      const unsaved = state.tabs.filter((tab) => tab.dirty && !paths.includes(tab.path))
      const tabs = [...restored, ...unsaved]
      const open = (path: string | null): boolean => tabs.some((tab) => tab.path === path)
      const active = [activePath, state.activePath].find(open) ?? tabs[0]?.path ?? null
      return { tabs, activePath: active }
    })
}))
