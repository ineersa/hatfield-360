import { create } from 'zustand'
import { separatorOf } from '@/components/editor/editor-tab-labels'
import { terminalTabControllers } from '@/components/terminal/terminal-tab-controllers'
import { useTerminalStore } from './terminal-store'
import { useWorkspaceStore } from './workspace-store'
import { useWorktreeStore } from './worktree-store'

type MemorySearchState = {
  /** The project being searched while the popup is open; null when it is closed. */
  project: string | null
  /** What had focus before the popup opened, to give it back on close. */
  returnFocus: HTMLElement | null
  /**
   * Opens the popup for `project`, or for the active terminal's project, else the first one.
   * Focus goes back to `returnFocus` on close, or to what has focus now.
   */
  open: (project?: string, returnFocus?: HTMLElement | null) => void
  close: () => void
}

const isInsideFolder = (path: string, folder: string): boolean =>
  path === folder || path.startsWith(folder + separatorOf(folder))

function activeProject(): string | null {
  const projects = (useWorkspaceStore.getState().workspace?.folders ?? []).filter(
    (folder) => folder.kind === 'project' && !folder.missing
  )
  const { tabs, activeTabId } = useTerminalStore.getState()
  const tab = tabs.find((candidate) => candidate.id === activeTabId)
  const cwd = tab ? (terminalTabControllers.get(tab.id)?.activeCwd() ?? tab.cwd) : null
  const worktrees = useWorktreeStore.getState().projects
  const owner =
    cwd === null
      ? undefined
      : projects.find((folder) => {
          const linked = worktrees[folder.path]
          return (
            isInsideFolder(cwd, folder.path) ||
            (linked?.status === 'git' &&
              linked.worktrees.some((tree) => isInsideFolder(cwd, tree.path)))
          )
        })
  return owner?.path ?? projects[0]?.path ?? null
}

export const useMemorySearchStore = create<MemorySearchState>((set, get) => ({
  project: null,
  returnFocus: null,
  open: (project, returnFocus) => {
    const focused = returnFocus ?? document.activeElement
    set({
      project: project ?? activeProject(),
      // Reopening for another project keeps where focus goes back to.
      returnFocus:
        get().project === null
          ? focused instanceof HTMLElement
            ? focused
            : null
          : get().returnFocus
    })
  },
  close: () => set({ project: null })
}))
