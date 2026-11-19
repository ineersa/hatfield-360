import { app, ipcMain } from 'electron'
import { type AppInfo, IPC_CHANNELS } from '../../shared/desktop-api'

export function registerAppInfoIpc(): void {
  ipcMain.handle(IPC_CHANNELS.getAppInfo, (): AppInfo => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    electronVersion: process.versions.electron
  }))
}
