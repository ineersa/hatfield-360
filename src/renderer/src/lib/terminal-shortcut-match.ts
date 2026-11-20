import { TERMINAL_COMMANDS, type TerminalCommand } from '../../../shared/terminal-api'
import { terminalShortcut } from '../../../shared/terminal-shortcuts'

const KEY_CODES: Record<string, string> = {
  ']': 'BracketRight',
  '[': 'BracketLeft',
  PageDown: 'PageDown',
  PageUp: 'PageUp'
}

type KeyPress = Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>

/** Whether a key press is an Electron accelerator such as `Ctrl+Shift+D` (matched by physical key). */
function matchesAccelerator(event: KeyPress, accelerator: string): boolean {
  const parts = accelerator.split('+')
  const key = parts.pop()
  if (!key) return false
  const code = KEY_CODES[key] ?? (/^[A-Z]$/.test(key) ? `Key${key}` : null)
  return (
    code === event.code &&
    parts.includes('Ctrl') === event.ctrlKey &&
    parts.includes('Shift') === event.shiftKey &&
    parts.includes('Alt') === event.altKey &&
    parts.includes('Command') === event.metaKey
  )
}

/**
 * The Terminal menu command a key press stands for. A focused terminal sees keys before the
 * menu does, so the page runs the command itself and stops the key there.
 */
export function terminalCommandForKey(event: KeyPress, platform: string): TerminalCommand | null {
  return (
    TERMINAL_COMMANDS.find((command) =>
      matchesAccelerator(event, terminalShortcut(command, platform))
    ) ?? null
  )
}
