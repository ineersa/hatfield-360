import { type BrowserWindow, dialog } from 'electron'
import { workspaceStore } from './workspace-store'

/** Asks for a folder with the native picker and adds it to the open workspace. */
export async function pickAndAddWorkspaceFolder(parent: BrowserWindow | null): Promise<void> {
  const options = { title: 'Add Folder to Workspace', properties: ['openDirectory' as const] }
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options)
  const [folder] = result.filePaths
  if (result.canceled || folder === undefined) return
  await workspaceStore.addFolder(folder)
}
