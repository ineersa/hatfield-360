import { BrowserWindow } from 'electron'
import type { WorkspaceFolder } from '../../shared/workspace-api'
import { WORKTREE_CHANNELS } from '../../shared/worktree-api'
import { type WatchedFolder, worktreeStore } from '../git/worktree-store'
import { workspaceStore } from '../workspace/workspace-store'
import { handleTrusted } from './trusted-ipc'

/** Projects git can look into: missing ones stay listed in the workspace but have nothing to show. */
const presentFolders = (folders: WorkspaceFolder[]): WatchedFolder[] =>
  folders
    .filter((folder) => folder.kind === 'project' && !folder.missing)
    .map(({ path, multiRepo }) => ({ path, multiRepo }))

let loaded: Promise<void> = Promise.resolve()

/** Settles once the open workspace's worktrees have first been listed. */
export const worktreesListed = (): Promise<void> => loaded

export function registerWorktreeIpc(): void {
  loaded = workspaceStore
    .view()
    .then((view) => worktreeStore.setFolders(presentFolders(view.folders)))
    .catch((error: unknown) => console.error('Listing worktrees failed:', error))

  workspaceStore.onChange((view) => void worktreeStore.setFolders(presentFolders(view.folders)))

  handleTrusted(WORKTREE_CHANNELS.get, async () => {
    await loaded
    return worktreeStore.view()
  })

  handleTrusted(WORKTREE_CHANNELS.pruneMissing, async (_event, project: unknown, path: unknown) => {
    if (typeof project !== 'string' || typeof path !== 'string') {
      throw new Error('Invalid worktree request')
    }
    await loaded
    const workspace = await workspaceStore.view()
    if (
      workspace.problem ||
      !presentFolders(workspace.folders).some((folder) => folder.path === project)
    ) {
      throw new Error('Project is not in the writable workspace')
    }
    await worktreeStore.pruneMissing(project, path)
  })

  worktreeStore.onChange((projects) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(WORKTREE_CHANNELS.changed, projects)
    }
  })
}
