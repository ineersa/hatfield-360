import { create } from 'zustand'
import type { WorkspaceView } from '../../../shared/workspace-api'

type WorkspaceState = {
  workspace: WorkspaceView | null
  error: string | null
  /** Loads the workspace and follows changes made in main (File menu, other windows); returns the unsubscribe. */
  connect: () => () => void
  addFolder: () => Promise<void>
  removeFolder: (path: string) => Promise<void>
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export const useWorkspaceStore = create<WorkspaceState>((set) => {
  const run = async (action: () => Promise<void>): Promise<void> => {
    try {
      await action()
      set({ error: null })
    } catch (error) {
      set({ error: message(error) })
    }
  }

  return {
    workspace: null,
    error: null,
    connect: () => {
      const unsubscribe = window.desktop.subscribeWorkspace((workspace) => set({ workspace }))
      void run(async () => set({ workspace: await window.desktop.getWorkspace() }))
      return unsubscribe
    },
    addFolder: () => run(() => window.desktop.addWorkspaceFolder()),
    removeFolder: (path) => run(() => window.desktop.removeWorkspaceFolder(path))
  }
})
