import { app } from 'electron'
import { type AppInfo, IPC_CHANNELS } from '../../shared/desktop-api'
import { handleTrusted } from './trusted-ipc'

export function registerAppInfoIpc(): void {
  handleTrusted(IPC_CHANNELS.getAppInfo, (): AppInfo => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    electronVersion: process.versions.electron
  }))
}
