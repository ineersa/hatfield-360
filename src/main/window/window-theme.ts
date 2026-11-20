import { BrowserWindow } from 'electron'
import { type AppThemeId, DEFAULT_SETTINGS } from '../../shared/settings-api'
import { APP_THEMES } from '../../shared/themes/app-theme-catalog'
import { settingsStore } from '../settings/settings-store'

/** The app theme's frame colour: what the window shows before the page paints and while it resizes. */
export function appThemeFrame(id: AppThemeId): string {
  const theme =
    APP_THEMES.find((candidate) => candidate.id === id) ??
    APP_THEMES.find((candidate) => candidate.id === DEFAULT_SETTINGS['workbench.colorTheme'])
  return theme?.frame ?? '#000000'
}

/** The app theme in settings.json, or the default when the file can't be read. */
export async function chosenAppTheme(): Promise<AppThemeId> {
  try {
    return (await settingsStore.view()).values['workbench.colorTheme']
  } catch {
    return DEFAULT_SETTINGS['workbench.colorTheme']
  }
}

/** Keeps every window's background on the chosen app theme's frame colour. */
export function followAppTheme(): void {
  settingsStore.onChange(({ values }) => {
    const frame = appThemeFrame(values['workbench.colorTheme'])
    for (const window of BrowserWindow.getAllWindows()) window.setBackgroundColor(frame)
  })
}
