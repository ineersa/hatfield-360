import { contextBridge, ipcRenderer } from 'electron'
import { type DesktopApi, IPC_CHANNELS } from '../shared/desktop-api'

const desktopApi: DesktopApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getAppInfo)
}

contextBridge.exposeInMainWorld('desktop', desktopApi)
