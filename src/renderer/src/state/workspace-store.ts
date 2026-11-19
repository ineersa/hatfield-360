import { create } from 'zustand'
import type { RecentTarget, WorkspaceView } from '../../../shared/workspace-api'

type WorkspaceState = {
  workspace: WorkspaceView | null
  error: string | null
  /** A notice from main the user closed; a different notice shows again. */
  dismissedNotice: string | null
  dismissMessage: () => void
  /** Loads the workspace and follows changes made in main (File menu, other windows); returns the unsubscribe. */
  connect: () => () => void
  addFolder: () => Promise<void>
  removeFolder: (path: string) => Promise<void>
  openWorkspaceFile: () => Promise<void>
  openRecent: (target: RecentTarget) => Promise<void>
  removeRecent: (target: RecentTarget) => Promise<void>
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Electron prefixes errors thrown in main with "Error invoking remote method '<channel>': Error: ". */
const mainErrorMessage = (error: unknown): string =>
  message(error).replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '')

export const useWorkspaceStore = create<WorkspaceState>((set, get) => {
  const run = async (action: () => Promise<void>): Promise<void> => {
    try {
      await action()
      set({ error: null })
    } catch (error) {
      set({ error: mainErrorMessage(error) })
    }
  }

  return {
    workspace: null,
    error: null,
    dismissedNotice: null,
    dismissMessage: () => set({ error: null, dismissedNotice: get().workspace?.notice ?? null }),
    connect: () => {
      const unsubscribe = window.desktop.subscribeWorkspace((workspace) => set({ workspace }))
      void run(async () => set({ workspace: await window.desktop.getWorkspace() }))
      return unsubscribe
    },
    addFolder: () => run(() => window.desktop.addWorkspaceFolder()),
    removeFolder: (path) => run(() => window.desktop.removeWorkspaceFolder(path)),
    openWorkspaceFile: () => run(() => window.desktop.openWorkspaceFile()),
    openRecent: ({ kind, path }) => run(() => window.desktop.openRecent({ kind, path })),
    removeRecent: ({ kind, path }) => run(() => window.desktop.removeRecent({ kind, path }))
  }
})
