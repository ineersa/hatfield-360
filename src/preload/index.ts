import { contextBridge, ipcRenderer } from 'electron'
import { type DesktopApi, IPC_CHANNELS } from '../shared/desktop-api'
import { SETTINGS_CHANNELS, type SettingsView } from '../shared/settings-api'
import { type WorkspaceView, WORKSPACE_CHANNELS } from '../shared/workspace-api'

const desktopApi: DesktopApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getAppInfo),
  getWorkspace: () => ipcRenderer.invoke(WORKSPACE_CHANNELS.get),
  addWorkspaceFolder: () => ipcRenderer.invoke(WORKSPACE_CHANNELS.addFolder),
  removeWorkspaceFolder: (path) => ipcRenderer.invoke(WORKSPACE_CHANNELS.removeFolder, path),
  openWorkspaceFile: () => ipcRenderer.invoke(WORKSPACE_CHANNELS.openFile),
  openRecent: (target) => ipcRenderer.invoke(WORKSPACE_CHANNELS.openRecent, target),
  removeRecent: (target) => ipcRenderer.invoke(WORKSPACE_CHANNELS.removeRecent, target),
  subscribeWorkspace: (callback) => {
    const listener = (_event: unknown, workspace: WorkspaceView): void => callback(workspace)
    ipcRenderer.on(WORKSPACE_CHANNELS.changed, listener)
    return () => ipcRenderer.removeListener(WORKSPACE_CHANNELS.changed, listener)
  },
  getSettings: () => ipcRenderer.invoke(SETTINGS_CHANNELS.get),
  subscribeSettings: (callback) => {
    const listener = (_event: unknown, settings: SettingsView): void => callback(settings)
    ipcRenderer.on(SETTINGS_CHANNELS.changed, listener)
    return () => ipcRenderer.removeListener(SETTINGS_CHANNELS.changed, listener)
  }
}

contextBridge.exposeInMainWorld('desktop', desktopApi)
