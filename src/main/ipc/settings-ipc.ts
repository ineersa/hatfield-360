import { BrowserWindow } from 'electron'
import { SETTINGS_CHANNELS } from '../../shared/settings-api'
import { openSettingsFile } from '../settings/open-settings-file'
import { isSettingKey } from '../settings/settings-document'
import { settingsStore } from '../settings/settings-store'
import { handleTrusted } from './trusted-ipc'

export function registerSettingsIpc(): void {
  handleTrusted(SETTINGS_CHANNELS.get, () => settingsStore.view())

  // The store checks the value against the setting's own rules.
  handleTrusted(SETTINGS_CHANNELS.update, (_event, key, value) => {
    if (typeof key !== 'string' || !isSettingKey(key)) throw new Error('Unknown setting')
    return settingsStore.update(key, value)
  })

  handleTrusted(SETTINGS_CHANNELS.openFile, () => openSettingsFile())

  settingsStore.onChange((view) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(SETTINGS_CHANNELS.changed, view)
    }
  })
  settingsStore
    .watch()
    .catch((error: unknown) => console.error('Watching settings.json failed:', error))
}

/** Shows the Settings page in a window (File → Preferences → Settings). */
export function showSettingsPage(window: BrowserWindow | null): Promise<void> {
  if (!window) return Promise.reject(new Error('No window to show the settings in.'))
  window.webContents.send(SETTINGS_CHANNELS.showPage)
  return Promise.resolve()
}
