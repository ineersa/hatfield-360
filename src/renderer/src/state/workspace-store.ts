import { hydrateTerminals } from './terminal-workspace'
import { create } from 'zustand'
import { mainErrorMessage } from '@/lib/main-error-message'
import { followNotice, notify } from '@/state/notification-store'
import type {
  RecentTarget,
  WorkspaceFolderKind,
  WorkspaceView
} from '../../../shared/workspace-api'

type WorkspaceState = {
  workspace: WorkspaceView | null
  /** Loads the workspace and follows changes made in main (File menu, other windows); returns the unsubscribe. */
  connect: () => () => void
  apply: (workspace: WorkspaceView) => void
  addFolder: () => Promise<void>
  removeFolder: (path: string) => Promise<void>
  setFolderKind: (path: string, kind: WorkspaceFolderKind) => Promise<void>
  openWorkspaceFile: () => Promise<void>
  openRecent: (target: RecentTarget) => Promise<void>
  removeRecent: (target: RecentTarget) => Promise<void>
}

const showNotice = followNotice((body) => ({ severity: 'error', title: 'Workspace', body }))

/** Runs a workspace action; a failure is shown as a notification. */
async function run(action: () => Promise<void>): Promise<void> {
  try {
    await action()
  } catch (error) {
    notify({ severity: 'error', title: 'Workspace', body: mainErrorMessage(error) })
  }
}

export const useWorkspaceStore = create<WorkspaceState>((set) => {
  const apply = (workspace: WorkspaceView): void => {
    hydrateTerminals(workspace)
    set({ workspace })
    showNotice(workspace.notice)
  }
  return {
    workspace: null,
    apply,
    connect: () => {
      const unsubscribe = window.desktop.subscribeWorkspace(apply)
      void run(async () => apply(await window.desktop.getWorkspace()))
      return unsubscribe
    },
    addFolder: () => run(() => window.desktop.addWorkspaceFolder()),
    removeFolder: (path) => run(() => window.desktop.removeWorkspaceFolder(path)),
    setFolderKind: (path, kind) => run(() => window.desktop.setWorkspaceFolderKind(path, kind)),
    openWorkspaceFile: () => run(() => window.desktop.openWorkspaceFile()),
    openRecent: ({ kind, path }) => run(() => window.desktop.openRecent({ kind, path })),
    removeRecent: ({ kind, path }) => run(() => window.desktop.removeRecent({ kind, path }))
  }
})
