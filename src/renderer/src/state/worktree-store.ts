import { mainErrorMessage } from '@/lib/main-error-message'
import { notify } from './notification-store'
import { create } from 'zustand'
import type { ProjectWorktrees } from '../../../shared/worktree-api'

type WorktreeState = {
  /** Per project folder; a folder missing from the map hasn't been looked at yet. */
  projects: Record<string, ProjectWorktrees>
  /** Project folders whose worktree rows are hidden; kept while the app runs. */
  collapsed: Record<string, boolean>
  toggleCollapsed: (folder: string) => void
  /** Removes only the selected missing worktree registration. */
  pruneMissing: (project: string, path: string) => Promise<void>
  /** Loads the worktrees and follows git changes main sees; returns the unsubscribe. */
  connect: () => () => void
}

const byFolder = (projects: ProjectWorktrees[]): Record<string, ProjectWorktrees> =>
  Object.fromEntries(projects.map((project) => [project.folder, project]))

export const useWorktreeStore = create<WorktreeState>((set) => ({
  projects: {},
  collapsed: {},
  toggleCollapsed: (folder) =>
    set((state) => ({ collapsed: { ...state.collapsed, [folder]: !state.collapsed[folder] } })),
  pruneMissing: async (project, path) => {
    try {
      await window.desktop.pruneMissingWorktrees(project, path)
    } catch (error: unknown) {
      notify({
        severity: 'error',
        title: 'Could not remove missing worktree entry',
        body: mainErrorMessage(error)
      })
    }
  },
  connect: () => {
    const unsubscribe = window.desktop.subscribeWorktrees((projects) =>
      set({ projects: byFolder(projects) })
    )
    // Main answers even when git fails (the failure is the project's state), so a rejection is a bug.
    window.desktop
      .getWorktrees()
      .then((projects) => set({ projects: byFolder(projects) }))
      .catch((error: unknown) => console.error('Loading worktrees failed:', error))
    return unsubscribe
  }
}))
