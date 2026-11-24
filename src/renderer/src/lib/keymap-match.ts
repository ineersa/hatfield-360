import {
  appShortcut,
  terminalShortcut,
  type AppCommand,
  type ShellKeymap
} from '../../../shared/keymap'
import type { TerminalCommand } from '../../../shared/terminal-api'
import { matchesShortcut, rendererPlatform, shortcutLabel, type KeyPress } from './shortcut-keys'

/**
 * The Terminal menu command a key press stands for. A focused terminal sees keys before the
 * menu does, so the page runs the command itself and stops the key there.
 */
export function terminalCommandForKey(
  event: KeyPress,
  keymap: ShellKeymap
): TerminalCommand | null {
  const binding = keymap.findLast(
    (candidate) => candidate.kind === 'terminal' && matchesShortcut(event, candidate.key)
  )
  return binding?.kind === 'terminal' ? binding.command : null
}

export function appCommandForKey(event: KeyPress, keymap: ShellKeymap): AppCommand | null {
  const binding = keymap.findLast(
    (candidate) => candidate.kind === 'app' && matchesShortcut(event, candidate.key)
  )
  return binding?.kind === 'app' ? binding.command : null
}

const label = (accelerator: string | null): string =>
  accelerator === null ? '' : shortcutLabel(accelerator, rendererPlatform)

export function terminalShortcutLabel(keymap: ShellKeymap, command: TerminalCommand): string {
  return label(terminalShortcut(keymap, command))
}

export function appShortcutLabel(keymap: ShellKeymap, command: AppCommand): string {
  return label(appShortcut(keymap, command))
}
