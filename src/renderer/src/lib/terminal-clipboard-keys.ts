/**
 * What a key press in a terminal does instead of going to the shell as xterm would send it.
 * `app-paste` sends ^V, so the program reads the clipboard itself (an image, in Claude Code).
 */
export type TerminalClipboardAction = 'copy' | 'paste' | 'app-paste' | 'ignore' | null

type KeyPress = Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>

/**
 * Linux and Windows: Ctrl+V and Shift+Insert paste; Ctrl+C copies a selection (without one it
 * stays the interrupt); Ctrl+Shift+C and Ctrl+Insert copy. Ctrl+Shift+V goes to the program as
 * ^V, the key TUIs such as Claude Code read as "paste the clipboard image yourself".
 * macOS keeps Command for the clipboard, so its Control keys all go to the shell (null).
 */
export function terminalClipboardAction(
  event: KeyPress,
  platform: string,
  hasSelection: boolean
): TerminalClipboardAction {
  if (platform === 'darwin' || event.altKey || event.metaKey) return null
  const { code, ctrlKey, shiftKey } = event
  if (code === 'Insert') {
    if (shiftKey && !ctrlKey) return 'paste'
    if (ctrlKey && !shiftKey) return hasSelection ? 'copy' : null
    return null
  }
  if (!ctrlKey) return null
  if (code === 'KeyV') return shiftKey ? 'app-paste' : 'paste'
  if (code === 'KeyC') {
    if (hasSelection) return 'copy'
    // Ctrl+Shift+C is the copy key; with nothing selected it does nothing rather than interrupt.
    return shiftKey ? 'ignore' : null
  }
  return null
}
