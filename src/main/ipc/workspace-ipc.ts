import { BrowserWindow } from 'electron'
import { WORKSPACE_CHANNELS } from '../../shared/workspace-api'
import { pickAndAddWorkspaceFolder } from '../workspace/workspace-folder-picker'
import { workspaceStore } from '../workspace/workspace-store'
import { handleTrusted } from './trusted-ipc'

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

  workspaceStore.onChange((view) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(WORKSPACE_CHANNELS.changed, view)
    }
  })
}
