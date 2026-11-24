import type { Terminal } from '@xterm/xterm'
import { terminalClipboardAction } from '@/lib/terminal-clipboard-keys'
import { rendererPlatform } from '@/lib/shortcut-keys'
import { useSettingsStore } from '@/state/settings-store'

/** The byte Ctrl+V sends; TUIs (Claude Code, ...) read it as "paste the clipboard image". */
const CTRL_V = '\x16'

function trimOnCopy(): boolean {
  return useSettingsStore.getState().values['terminal.trimLeadingWhitespaceOnCopy']
}

function trimLineStarts(text: string): string {
  return text.replace(/(^|[\r\n])[ \t]+/g, '$1')
}

/** Puts the terminal's selection on the clipboard and clears it. */
export function copyTerminalSelection(terminal: Terminal): void {
  const selection = terminal.getSelection()
  const text = trimOnCopy() ? trimLineStarts(selection) : selection
  void window.desktop.writeTerminalClipboard(text).catch(() => undefined)
  terminal.clearSelection()
}

/** Pastes the clipboard's text; with none (an image), sends ^V so the program pastes it itself. */
export function pasteIntoTerminal(terminal: Terminal): void {
  void window.desktop
    .readTerminalClipboard()
    .then((text) => (text ? terminal.paste(text) : terminal.input(CTRL_V)))
    .catch(() => undefined)
}

/**
 * The system's copy and paste keys work in the terminal instead of reaching the shell as ^C/^V.
 * The clipboard is main's: a keypress can't wait for the page's clipboard permission.
 */
export function bindClipboardKeys(terminal: Terminal): void {
  // Native Edit → Copy (including Cmd+C) otherwise goes straight to xterm's copy handler.
  terminal.element?.addEventListener(
    'copy',
    (event) => {
      if (!trimOnCopy() || !terminal.hasSelection() || !event.clipboardData) return
      event.clipboardData.setData('text/plain', trimLineStarts(terminal.getSelection()))
      event.preventDefault()
      event.stopPropagation()
    },
    true
  )
  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown') return true
    const action = terminalClipboardAction(event, rendererPlatform, terminal.hasSelection())
    if (action === null) return true
    // Handled here: neither xterm nor the Edit menu acts on the key as well.
    event.preventDefault()
    if (action === 'copy') copyTerminalSelection(terminal)
    else if (action === 'app-paste') terminal.input(CTRL_V)
    else if (action === 'paste') pasteIntoTerminal(terminal)
    return false
  })
}
