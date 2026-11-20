import { DEFAULT_SETTINGS } from '../../../shared/settings-api'
import { APP_THEMES } from '../../../shared/themes/app-theme-catalog'

/** Switches the page to an app theme (assets/themes/app/<id>.css); an unknown id gets the default. */
export function applyAppTheme(id: string | null): void {
  const known = APP_THEMES.some((theme) => theme.id === id)
  document.documentElement.dataset.theme =
    known && id !== null ? id : DEFAULT_SETTINGS['workbench.colorTheme']
}
