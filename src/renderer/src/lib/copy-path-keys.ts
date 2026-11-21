import type { PathForm } from '../../../shared/file-tree-api'

type KeyPress = Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>

/**
 * The path a key press copies from the file tree, as in JetBrains IDEs: Ctrl+Shift+C (⌘⇧C on
 * macOS) copies the absolute path, and adding Alt copies it relative to its root folder.
 */
export function copyPathFormForKey(event: KeyPress, platform: string): PathForm | null {
  if (event.code !== 'KeyC' || !event.shiftKey) return null
  const command =
    platform === 'darwin' ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
  if (!command) return null
  return event.altKey ? 'relative' : 'absolute'
}

export function copyPathShortcutLabel(form: PathForm, platform: string): string {
  if (platform === 'darwin') return form === 'absolute' ? '⌘⇧C' : '⌘⌥⇧C'
  return form === 'absolute' ? 'Ctrl+Shift+C' : 'Ctrl+Alt+Shift+C'
}
