import { AgentProviderIcon } from '@/components/icons/AgentProviderIcon'
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
import { rendererPlatform, terminalShortcutLabel } from '@/lib/terminal-shortcut-label'
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
          <ContextMenuShortcut>{terminalShortcutLabel('split-right')}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => runCommand('split-down')}>
          <Rows2 aria-hidden />
          Split Down
          <ContextMenuShortcut>{terminalShortcutLabel('split-down')}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!launchable} onSelect={() => launchSplit('hatfield')}>
          <AgentProviderIcon provider="hatfield" />
          Launch Hatfield in New Split
        </ContextMenuItem>
        <ContextMenuItem disabled={!launchable} onSelect={() => launchSplit('claude')}>
          <AgentProviderIcon provider="claude" />
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
          <ContextMenuShortcut>{terminalShortcutLabel('close-pane')}</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
