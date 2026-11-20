import type { ITheme } from '@xterm/xterm'
import { DEFAULT_SETTINGS, type TerminalThemeId } from '../../../shared/settings-api'
import type { TerminalPalette } from '../../../shared/themes/terminal-palette'
import { TERMINAL_THEMES } from '../../../shared/themes/terminal-theme-catalog'

export function terminalPalette(id: TerminalThemeId): TerminalPalette {
  const theme =
    TERMINAL_THEMES.find((candidate) => candidate.id === id) ??
    TERMINAL_THEMES.find((candidate) => candidate.id === DEFAULT_SETTINGS['terminal.colorTheme'])
  if (!theme) throw new Error(`No terminal theme ${id}`)
  return theme.palette
}

/** xterm draws on a canvas and needs colour values, not CSS variables. */
export function terminalTheme(id: TerminalThemeId): ITheme {
  const { selection, ...palette } = terminalPalette(id)
  return { ...palette, cursorAccent: palette.background, selectionBackground: selection }
}
