import { useEffect } from 'react'
import { cssFontFamily } from '@/lib/css-font-family'
import { useSettingsStore } from '@/state/settings-store'
import { DEFAULT_SETTINGS } from '../../../../shared/settings-api'

const DEFAULT_APP_FONT = DEFAULT_SETTINGS['app.fontFamily']

/** Applies the app font settings to the whole UI through the CSS variables in main.css. */
export function useAppFont(): void {
  const family = useSettingsStore((state) => state.values['app.fontFamily'])
  const size = useSettingsStore((state) => state.values['app.fontSize'])
  useEffect(() => {
    const root = document.documentElement.style
    // The bundled font follows the user's choice, so a font that isn't installed still renders well.
    root.setProperty(
      '--app-font-family',
      family === DEFAULT_APP_FONT ? family : `${cssFontFamily(family)}, ${DEFAULT_APP_FONT}`
    )
    root.setProperty('--app-font-size', `${size}px`)
  }, [family, size])
}
