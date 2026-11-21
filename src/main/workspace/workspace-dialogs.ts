import {
  type BrowserWindow,
  dialog,
  type MessageBoxOptions,
  type OpenDialogOptions,
  type SaveDialogOptions
} from 'electron'
import { mkdir, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import type { RecentTarget } from '../../shared/workspace-api'
import { WORKSPACE_FILE_EXTENSION, withWorkspaceExtension } from './workspace-file'
import { workspaceStore } from './workspace-store'

const WORKSPACE_FILE_FILTERS = [
  { name: 'Hatfield 360 Workspace', extensions: [WORKSPACE_FILE_EXTENSION.slice(1)] }
]

// Native dialogs are modal to the window when there is one.
function showOpenDialog(parent: BrowserWindow | null, options: OpenDialogOptions) {
  return parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options)
}

function showSaveDialog(parent: BrowserWindow | null, options: SaveDialogOptions) {
  return parent ? dialog.showSaveDialog(parent, options) : dialog.showSaveDialog(options)
}

function showMessageBox(parent: BrowserWindow | null, options: MessageBoxOptions) {
  return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options)
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** Asks for a folder with the native picker and adds it to the open workspace. */
export async function pickAndAddWorkspaceFolder(parent: BrowserWindow | null): Promise<void> {
  const defaultPath = await workspaceStore.folderPickerStart()
  const result = await showOpenDialog(parent, {
    title: 'Add Folder to Workspace',
    ...(defaultPath === undefined ? {} : { defaultPath }),
    properties: ['openDirectory']
  })
  const [folder] = result.filePaths
  if (result.canceled || folder === undefined) return
  await workspaceStore.addFolder(folder)
}

export async function pickAndOpenWorkspaceFile(parent: BrowserWindow | null): Promise<void> {
  const result = await showOpenDialog(parent, {
    title: 'Open Workspace from File',
    defaultPath: workspaceStore.workspacesFolder(),
    properties: ['openFile'],
    filters: WORKSPACE_FILE_FILTERS
  })
  const [file] = result.filePaths
  if (result.canceled || file === undefined) return
  await workspaceStore.openWorkspaceFile(file)
}

/** Save Workspace As, or Duplicate (a copy named after the open workspace); both switch to the new file. */
export async function pickAndSaveWorkspaceAs(
  parent: BrowserWindow | null,
  mode: 'save-as' | 'duplicate'
): Promise<void> {
  const view = await workspaceStore.view()
  // Suggest Hatfield's own folder, where saved workspaces are listed without being in Recent.
  const directory = workspaceStore.workspacesFolder()
  await mkdir(directory, { recursive: true })
  const name =
    mode === 'duplicate' ? `${view.name} copy` : view.file ? view.name : 'Untitled Workspace'
  const result = await showSaveDialog(parent, {
    title: mode === 'duplicate' ? 'Duplicate Workspace' : 'Save Workspace As',
    defaultPath: join(directory, `${name}${WORKSPACE_FILE_EXTENSION}`),
    filters: WORKSPACE_FILE_FILTERS,
    // GTK only asks before replacing a file when told to; macOS and Windows always ask.
    properties: ['showOverwriteConfirmation']
  })
  if (result.canceled || !result.filePath) return
  const target = withWorkspaceExtension(result.filePath)
  // The dialog only checked the name as typed; adding the extension can land on an existing file.
  if (target !== resolve(result.filePath) && (await exists(target))) {
    const { response } = await showMessageBox(parent, {
      type: 'warning',
      message: `"${basename(target)}" already exists. Replace it?`,
      detail: target,
      buttons: ['Replace', 'Cancel'],
      defaultId: 1,
      cancelId: 1
    })
    if (response !== 0) return
  }
  await workspaceStore.saveWorkspaceAs(target)
}

/** Opens a Recent entry; when its file or folder is gone, offers to remove it from Recent. */
export async function openRecentOrOfferRemoval(
  parent: BrowserWindow | null,
  target: RecentTarget
): Promise<void> {
  if ((await workspaceStore.openRecent(target)) === 'opened') return
  const { response } = await showMessageBox(parent, {
    type: 'warning',
    message: `${target.kind === 'folder' ? 'This folder' : 'This workspace file'} no longer exists.`,
    detail: target.path,
    buttons: ['Remove from Recent', 'Cancel'],
    defaultId: 0,
    cancelId: 1
  })
  if (response === 0) await workspaceStore.removeRecent(target)
}
