import type { Terminal } from '@xterm/xterm'
import { terminalClipboardAction } from '@/lib/terminal-clipboard-keys'
import { rendererPlatform } from '@/lib/terminal-shortcut-label'

/** The byte Ctrl+V sends; TUIs (Claude Code, ...) read it as "paste the clipboard image". */
const CTRL_V = '\x16'

/**
 * The system's copy and paste keys work in the terminal instead of reaching the shell as ^C/^V.
 * A paste with no text on the clipboard (an image) sends ^V on, so the program can paste the
 * image itself. The clipboard is main's: a keypress can't wait for the page's clipboard permission.
 */
export function bindClipboardKeys(terminal: Terminal): void {
  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown') return true
    const action = terminalClipboardAction(event, rendererPlatform, terminal.hasSelection())
    if (action === null) return true
    // Handled here: neither xterm nor the Edit menu acts on the key as well.
    event.preventDefault()
    if (action === 'copy') {
      void window.desktop.writeTerminalClipboard(terminal.getSelection()).catch(() => undefined)
      terminal.clearSelection()
    } else if (action === 'app-paste') {
      terminal.input(CTRL_V)
    } else if (action === 'paste') {
      void window.desktop
        .readTerminalClipboard()
        .then((text) => (text ? terminal.paste(text) : terminal.input(CTRL_V)))
        .catch(() => undefined)
    }
    return false
  })
}
