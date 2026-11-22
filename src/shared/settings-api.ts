import type { AgentProfile } from './agent-api'
import type { Notice } from './notice'
import type { APP_THEMES } from './themes/app-theme-catalog'
import type { EDITOR_THEMES } from './themes/editor-theme-catalog'
import type { TERMINAL_THEMES } from './themes/terminal-theme-catalog'

/** Every user setting with its value; `settings.json` holds only the ones the user changed. */
export type Settings = {
  'agents.hatfield': AgentProfile
  'agents.claude': AgentProfile
  'app.fontFamily': string
  'app.fontSize': number
  'terminal.fontFamily': string
  'terminal.fontSize': number
  /** Line height as a multiple of the font size. */
  'terminal.lineHeight': number
  /** Draw terminals with WebGL; off uses the slower DOM renderer, for GPUs that render them wrong. */
  'terminal.gpuAcceleration': boolean
  'terminal.trimLeadingWhitespaceOnCopy': boolean
  'editor.fontFamily': string
  'editor.fontSize': number
  /** Line height as a multiple of the font size. */
  'editor.lineHeight': number
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

/** A number setting's allowed values: outside the range it is clamped; the Settings page steps by `step`. */
export type NumberRange = { min: number; max: number; step: number }

export const FONT_SIZE_RANGE: NumberRange = { min: 8, max: 32, step: 1 }

export const LINE_HEIGHT_RANGE: NumberRange = { min: 1, max: 2, step: 0.1 }

const MONOSPACE_FONTS =
  "'JetBrains Mono', 'Cascadia Code', 'SF Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace"

export const DEFAULT_SETTINGS: Settings = {
  'agents.hatfield': { executable: 'hatfield', args: [] },
  'agents.claude': { executable: 'claude', args: [] },
  'app.fontFamily': "'Inter Variable', system-ui, sans-serif",
  'app.fontSize': 14,
  'terminal.fontFamily': MONOSPACE_FONTS,
  'terminal.fontSize': 13,
  'terminal.lineHeight': 1,
  'terminal.gpuAcceleration': true,
  'terminal.trimLeadingWhitespaceOnCopy': false,
  'editor.fontFamily': MONOSPACE_FONTS,
  'editor.fontSize': 13,
  // JetBrains IDEs' default line spacing.
  'editor.lineHeight': 1.2,
  'workbench.iconTheme': 'catppuccin',
  'workbench.colorTheme': 'islands-dark',
  'editor.colorTheme': 'islands-dark',
  'terminal.colorTheme': 'dracula'
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
