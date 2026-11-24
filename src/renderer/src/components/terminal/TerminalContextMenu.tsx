import type { AgentProvider } from '../../../../shared/agent-api'
import type { Terminal } from '@xterm/xterm'
import { Clipboard, Columns2, Copy, Eraser, Rows2, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { terminalShortcutLabel } from '@/lib/keymap-match'
import { rendererPlatform } from '@/lib/shortcut-keys'
import { useKeymapStore } from '@/state/keymap-store'
import { copyTerminalSelection, pasteIntoTerminal } from './terminal-clipboard'

const CLIPBOARD_KEYS =
  rendererPlatform === 'darwin' ? { copy: '⌘C', paste: '⌘V' } : { copy: 'Ctrl+C', paste: 'Ctrl+V' }

/**
 * Right-click on a tab's panes. The click has already made its pane the active one (panes take
 * focus on pointer down), so every item acts on the terminal under the mouse.
 */
export function TerminalContextMenu({
  activeTerminal,
  runCommand,
  launchSplit,
  canLaunch,
  children
}: {
  activeTerminal: () => Terminal | null
  runCommand: (command: 'split-right' | 'split-down' | 'close-pane') => void
  launchSplit: (provider: AgentProvider) => void
  canLaunch: () => boolean
  children: ReactNode
}): React.JSX.Element {
  const keymap = useKeymapStore((state) => state.shell)
  const [launchable, setLaunchable] = useState(false)
  const [hasSelection, setHasSelection] = useState(false)
  const withTerminal = (action: (terminal: Terminal) => void) => () => {
    const terminal = activeTerminal()
    if (terminal) action(terminal)
  }

  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (open) {
          setHasSelection(activeTerminal()?.hasSelection() ?? false)
          setLaunchable(canLaunch())
        }
        // Back to typing in the terminal once the closing menu has let go of focus.
        else setTimeout(() => activeTerminal()?.focus(), 0)
      }}
    >
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent onCloseAutoFocus={(event) => event.preventDefault()}>
        <ContextMenuItem disabled={!hasSelection} onSelect={withTerminal(copyTerminalSelection)}>
          <Copy aria-hidden />
          Copy
          <ContextMenuShortcut>{CLIPBOARD_KEYS.copy}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={withTerminal(pasteIntoTerminal)}>
          <Clipboard aria-hidden />
          Paste
          <ContextMenuShortcut>{CLIPBOARD_KEYS.paste}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => runCommand('split-right')}>
          <Columns2 aria-hidden />
          Split Right
          <ContextMenuShortcut>{terminalShortcutLabel(keymap, 'split-right')}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => runCommand('split-down')}>
          <Rows2 aria-hidden />
          Split Down
          <ContextMenuShortcut>{terminalShortcutLabel(keymap, 'split-down')}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!launchable} onSelect={() => launchSplit('hatfield')}>
          Launch Hatfield in New Split
        </ContextMenuItem>
        <ContextMenuItem disabled={!launchable} onSelect={() => launchSplit('claude')}>
          Launch Claude in New Split
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={withTerminal((terminal) => terminal.clear())}>
          <Eraser aria-hidden />
          Clear
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => runCommand('close-pane')}>
          <X aria-hidden />
          Close Pane
          <ContextMenuShortcut>{terminalShortcutLabel(keymap, 'close-pane')}</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
