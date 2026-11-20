import type { TerminalCommand } from './terminal-api'

/**
 * Electron accelerators per command: macOS uses Command; Linux and Windows add Shift (or Alt)
 * because Ctrl+letter belongs to the shell (Ctrl+W deletes a word, Ctrl+D ends input).
 * The menu registers them and terminals recognise them, since a focused terminal sees keys first.
 */
const TERMINAL_SHORTCUTS: Record<TerminalCommand, { mac: string; other: string }> = {
  'new-terminal': { mac: 'Command+T', other: 'Ctrl+Shift+T' },
  'split-right': { mac: 'Command+D', other: 'Ctrl+Shift+D' },
  'split-down': { mac: 'Command+Shift+D', other: 'Alt+Shift+D' },
  'close-pane': { mac: 'Command+W', other: 'Ctrl+Shift+W' },
  'focus-next-pane': { mac: 'Command+]', other: 'Ctrl+Shift+]' },
  'focus-previous-pane': { mac: 'Command+[', other: 'Ctrl+Shift+[' },
  'next-tab': { mac: 'Command+Shift+]', other: 'Ctrl+PageDown' },
  'previous-tab': { mac: 'Command+Shift+[', other: 'Ctrl+PageUp' }
}

export function terminalShortcut(command: TerminalCommand, platform: string): string {
  const shortcut = TERMINAL_SHORTCUTS[command]
  return platform === 'darwin' ? shortcut.mac : shortcut.other
}
