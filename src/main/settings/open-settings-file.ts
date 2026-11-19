import { shell } from 'electron'
import { settingsStore } from './settings-store'

/** Opens settings.json in the system's default editor, creating it first. */
export async function openSettingsFile(): Promise<void> {
  const file = await settingsStore.ensureFile()
  // Only ever the app's own settings file, never a path from the renderer.
  const failure = await shell.openPath(file)
  if (failure) throw new Error(`Can't open ${file}: ${failure}`)
}
