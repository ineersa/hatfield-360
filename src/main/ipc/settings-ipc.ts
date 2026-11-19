import { BrowserWindow } from 'electron'
import { SETTINGS_CHANNELS } from '../../shared/settings-api'
import { settingsStore } from '../settings/settings-store'
import { handleTrusted } from './trusted-ipc'

export function registerSettingsIpc(): void {
  handleTrusted(SETTINGS_CHANNELS.get, () => settingsStore.view())

  settingsStore.onChange((view) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(SETTINGS_CHANNELS.changed, view)
    }
  })
  settingsStore
    .watch()
    .catch((error: unknown) => console.error('Watching settings.json failed:', error))
}
