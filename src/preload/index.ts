import { contextBridge, ipcRenderer } from 'electron'
import { type DesktopApi, IPC_CHANNELS } from '../shared/desktop-api'
import { type WorkspaceView, WORKSPACE_CHANNELS } from '../shared/workspace-api'

const desktopApi: DesktopApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getAppInfo),
  getWorkspace: () => ipcRenderer.invoke(WORKSPACE_CHANNELS.get),
  addWorkspaceFolder: () => ipcRenderer.invoke(WORKSPACE_CHANNELS.addFolder),
  removeWorkspaceFolder: (path) => ipcRenderer.invoke(WORKSPACE_CHANNELS.removeFolder, path),
  subscribeWorkspace: (callback) => {
    const listener = (_event: unknown, workspace: WorkspaceView): void => callback(workspace)
    ipcRenderer.on(WORKSPACE_CHANNELS.changed, listener)
    return () => ipcRenderer.removeListener(WORKSPACE_CHANNELS.changed, listener)
  }
}

contextBridge.exposeInMainWorld('desktop', desktopApi)
