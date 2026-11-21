import { BrowserWindow } from 'electron'
import { isPlainObject } from '../../shared/plain-object'
import { type RecentTarget, WORKSPACE_CHANNELS } from '../../shared/workspace-api'
import {
  openRecentOrOfferRemoval,
  pickAndAddWorkspaceFolder,
  pickAndOpenWorkspaceFile
} from '../workspace/workspace-dialogs'
import { workspaceStore } from '../workspace/workspace-store'
import { handleTrusted } from './trusted-ipc'

function parseRecentTarget(value: unknown): RecentTarget {
  if (
    isPlainObject(value) &&
    (value.kind === 'default' || value.kind === 'workspace' || value.kind === 'folder') &&
    typeof value.path === 'string'
  ) {
    return { kind: value.kind, path: value.path }
  }
  throw new Error('Expected a Recent entry')
}

export function registerWorkspaceIpc(): void {
  handleTrusted(WORKSPACE_CHANNELS.get, () => workspaceStore.view())

  handleTrusted(WORKSPACE_CHANNELS.addFolder, (event) =>
    pickAndAddWorkspaceFolder(BrowserWindow.fromWebContents(event.sender))
  )

  handleTrusted(WORKSPACE_CHANNELS.removeFolder, async (_event, path) => {
    if (typeof path !== 'string' || path === '') {
      throw new Error('removeWorkspaceFolder expects a folder path')
    }
    if (!(await workspaceStore.removeFolder(path))) {
      throw new Error(`Not in the workspace: ${path}`)
    }
  })

  handleTrusted(WORKSPACE_CHANNELS.setFolderKind, async (_event, path, kind) => {
    if (typeof path !== 'string' || path === '' || (kind !== 'project' && kind !== 'folder')) {
      throw new Error('setWorkspaceFolderKind expects a folder path and "project" or "folder"')
    }
    if (!(await workspaceStore.setFolderKind(path, kind))) {
      throw new Error(`Not in the workspace: ${path}`)
    }
  })

  handleTrusted(WORKSPACE_CHANNELS.openFile, (event) =>
    pickAndOpenWorkspaceFile(BrowserWindow.fromWebContents(event.sender))
  )

  handleTrusted(WORKSPACE_CHANNELS.openRecent, (event, target) =>
    openRecentOrOfferRemoval(BrowserWindow.fromWebContents(event.sender), parseRecentTarget(target))
  )

  handleTrusted(WORKSPACE_CHANNELS.removeRecent, (_event, target) =>
    workspaceStore.removeRecent(parseRecentTarget(target))
  )

  workspaceStore.onChange((view) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(WORKSPACE_CHANNELS.changed, view)
    }
  })
}
