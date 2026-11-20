import { useEffect } from 'react'
import { applyAppTheme } from '@/lib/app-theme'
import { terminalPalette } from '@/lib/terminal-theme'
import { useSettingsStore } from '@/state/settings-store'

/**
 * Applies the app theme and the terminal theme's background (behind and between the terminal panes)
 * as soon as settings arrive and on every change. Until then the page keeps the theme main opened it in.
 */
export function useColorThemes(): void {
  const loaded = useSettingsStore((state) => state.loaded)
  const appTheme = useSettingsStore((state) => state.values['workbench.colorTheme'])
  const terminalTheme = useSettingsStore((state) => state.values['terminal.colorTheme'])
  useEffect(() => {
    if (loaded) applyAppTheme(appTheme)
  }, [loaded, appTheme])
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--terminal-background',
      terminalPalette(terminalTheme).background
    )
  }, [terminalTheme])
}
