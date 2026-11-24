import { BrowserWindow } from 'electron'
import { KEYBINDINGS_CHANNELS } from '../../shared/keybindings-api'
import { keybindingsStore } from '../keybindings/keybindings-store'
import { handleTrusted } from './trusted-ipc'

export function registerKeybindingsIpc(): void {
  handleTrusted(KEYBINDINGS_CHANNELS.get, () => keybindingsStore.view())

  handleTrusted(KEYBINDINGS_CHANNELS.openFile, () => keybindingsStore.ensureFile())

  keybindingsStore.onChange((view) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(KEYBINDINGS_CHANNELS.changed, view)
    }
  })
  keybindingsStore
    .watch()
    .catch((error: unknown) => console.error('Watching keybindings.json failed:', error))
}

/** Opens keybindings.json in a window's editor (File → Preferences → Open Keybindings (JSON)). */
export async function showKeybindingsFile(window: BrowserWindow | null): Promise<void> {
  if (!window) throw new Error('No window to open keybindings.json in.')
  const file = await keybindingsStore.ensureFile()
  window.webContents.send(KEYBINDINGS_CHANNELS.showFile, file)
}
