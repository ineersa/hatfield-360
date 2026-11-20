import { create } from 'zustand'
import type { ProjectWorktrees } from '../../../shared/worktree-api'

type WorktreeState = {
  /** Per project folder; a folder missing from the map hasn't been looked at yet. */
  projects: Record<string, ProjectWorktrees>
  /** Loads the worktrees and follows git changes main sees; returns the unsubscribe. */
  connect: () => () => void
}

const byFolder = (projects: ProjectWorktrees[]): Record<string, ProjectWorktrees> =>
  Object.fromEntries(projects.map((project) => [project.folder, project]))

export const useWorktreeStore = create<WorktreeState>((set) => ({
  projects: {},
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
