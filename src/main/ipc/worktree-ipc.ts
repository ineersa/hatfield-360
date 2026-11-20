import { BrowserWindow } from 'electron'
import { WORKTREE_CHANNELS } from '../../shared/worktree-api'
import { worktreeStore } from '../git/worktree-store'
import { workspaceStore } from '../workspace/workspace-store'
import { handleTrusted } from './trusted-ipc'

/** Folders git can look into: missing ones stay listed in the workspace but have nothing to show. */
const presentFolders = (folders: { path: string; missing: boolean }[]): string[] =>
  folders.filter((folder) => !folder.missing).map((folder) => folder.path)

export function registerWorktreeIpc(): void {
  const loaded = workspaceStore
    .view()
    .then((view) => worktreeStore.setFolders(presentFolders(view.folders)))
    .catch((error: unknown) => console.error('Listing worktrees failed:', error))

  workspaceStore.onChange((view) => void worktreeStore.setFolders(presentFolders(view.folders)))

  handleTrusted(WORKTREE_CHANNELS.get, async () => {
    await loaded
    return worktreeStore.view()
  })

  worktreeStore.onChange((projects) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(WORKTREE_CHANNELS.changed, projects)
    }
  })
}
