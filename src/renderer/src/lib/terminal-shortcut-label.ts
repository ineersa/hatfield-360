import type { TerminalCommand } from '../../../shared/terminal-api'
import { terminalShortcut } from '../../../shared/terminal-shortcuts'

/** The platform the page runs on, as far as shortcuts care: macOS or not. */
export const rendererPlatform = /Mac/.test(navigator.userAgent) ? 'darwin' : 'other'

/** A command's shortcut as people read it: `⌘⇧D` on macOS, `Ctrl+Shift+D` elsewhere. */
export function terminalShortcutLabel(command: TerminalCommand): string {
  const accelerator = terminalShortcut(command, rendererPlatform)
  if (rendererPlatform !== 'darwin') return accelerator
  return accelerator.replace('Command+', '⌘').replace('Shift+', '⇧').replace('Alt+', '⌥')
}
