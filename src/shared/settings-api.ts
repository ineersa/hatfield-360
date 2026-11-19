import type { Notice } from './notice'

/** Every user setting with its value; `settings.json` holds only the ones the user changed. */
export type Settings = {
  'app.fontFamily': string
  'app.fontSize': number
  'terminal.fontFamily': string
  'terminal.fontSize': number
  'editor.fontFamily': string
  'editor.fontSize': number
  'workbench.iconTheme': IconTheme
}

export type IconTheme = 'catppuccin' | 'lucide'

export const ICON_THEMES: readonly IconTheme[] = ['catppuccin', 'lucide']

/** Font sizes outside this range are clamped. */
export const FONT_SIZE_RANGE = { min: 8, max: 32 } as const

const MONOSPACE_FONTS =
  "'JetBrains Mono', 'Cascadia Code', 'SF Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace"

export const DEFAULT_SETTINGS: Settings = {
  'app.fontFamily': "'Inter Variable', system-ui, sans-serif",
  'app.fontSize': 14,
  'terminal.fontFamily': MONOSPACE_FONTS,
  'terminal.fontSize': 13,
  'editor.fontFamily': MONOSPACE_FONTS,
  'editor.fontSize': 13,
  'workbench.iconTheme': 'catppuccin'
}

export type SettingsView = {
  values: Settings
  /** What is wrong with settings.json (bad values are ignored), or why it couldn't be opened. */
  notice: Notice | null
}

export const SETTINGS_CHANNELS = {
  get: 'settings:get',
  changed: 'settings:changed'
} as const

export type SettingsApi = {
  getSettings: () => Promise<SettingsView>
  subscribeSettings: (callback: (settings: SettingsView) => void) => () => void
}
