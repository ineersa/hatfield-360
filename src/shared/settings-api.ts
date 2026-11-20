import type { Notice } from './notice'
import type { APP_THEMES } from './themes/app-theme-catalog'
import type { EDITOR_THEMES } from './themes/editor-theme-catalog'
import type { TERMINAL_THEMES } from './themes/terminal-theme-catalog'

/** Every user setting with its value; `settings.json` holds only the ones the user changed. */
export type Settings = {
  'app.fontFamily': string
  'app.fontSize': number
  'terminal.fontFamily': string
  'terminal.fontSize': number
  /** Draw terminals with WebGL; off uses the slower DOM renderer, for GPUs that render them wrong. */
  'terminal.gpuAcceleration': boolean
  'editor.fontFamily': string
  'editor.fontSize': number
  'workbench.iconTheme': IconTheme
  /** The UI chrome's colours, text styles and shapes. */
  'workbench.colorTheme': AppThemeId
  /** Syntax, editor and diff colours. */
  'editor.colorTheme': EditorThemeId
  /** Terminal background, text and ANSI colours. */
  'terminal.colorTheme': TerminalThemeId
}

export type SettingKey = keyof Settings

export type IconTheme = 'catppuccin' | 'lucide'

export const ICON_THEMES: readonly IconTheme[] = ['catppuccin', 'lucide']

export type AppThemeId = (typeof APP_THEMES)[number]['id']
export type EditorThemeId = (typeof EDITOR_THEMES)[number]['id']
export type TerminalThemeId = (typeof TERMINAL_THEMES)[number]['id']

/** Font sizes outside this range are clamped. */
export const FONT_SIZE_RANGE = { min: 8, max: 32 } as const

const MONOSPACE_FONTS =
  "'JetBrains Mono', 'Cascadia Code', 'SF Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace"

export const DEFAULT_SETTINGS: Settings = {
  'app.fontFamily': "'Inter Variable', system-ui, sans-serif",
  'app.fontSize': 14,
  'terminal.fontFamily': MONOSPACE_FONTS,
  'terminal.fontSize': 13,
  'terminal.gpuAcceleration': true,
  'editor.fontFamily': MONOSPACE_FONTS,
  'editor.fontSize': 13,
  'workbench.iconTheme': 'catppuccin',
  'workbench.colorTheme': 'islands-dark',
  'editor.colorTheme': 'islands-dark',
  'terminal.colorTheme': 'islands-dark'
}

export type SettingsView = {
  values: Settings
  /** Settings the file sets; the rest are at their defaults. */
  customized: SettingKey[]
  /** False while settings.json can't be read as a JSON object; the Settings page can't change it then. */
  editable: boolean
  /** What is wrong with settings.json (bad values are ignored), or why it couldn't be opened. */
  notice: Notice | null
}

export const SETTINGS_CHANNELS = {
  get: 'settings:get',
  update: 'settings:update',
  openFile: 'settings:open-file',
  changed: 'settings:changed',
  showPage: 'settings:show-page'
} as const

export type SettingsApi = {
  getSettings: () => Promise<SettingsView>
  /** Writes one setting to settings.json, keeping the rest of the file; null resets it to the default. */
  updateSetting: <K extends SettingKey>(key: K, value: Settings[K] | null) => Promise<void>
  /** Opens settings.json in the system's default editor. */
  openSettingsFile: () => Promise<void>
  subscribeSettings: (callback: (settings: SettingsView) => void) => () => void
  /** File → Preferences → Settings asks the window to show the Settings page. */
  subscribeShowSettings: (callback: () => void) => () => void
}
