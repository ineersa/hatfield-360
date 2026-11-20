import { rendererPlatform } from '@/lib/terminal-shortcut-label'
import { useEffect } from 'react'
import { connectTerminalOutput } from '@/lib/terminal-output-router'
import { terminalCommandForKey } from '@/lib/terminal-shortcut-match'
import { useTerminalStore } from '@/state/terminal-store'
import { useWorkspaceStore } from '@/state/workspace-store'
import type { TerminalCommand } from '../../../../shared/terminal-api'
import { terminalTabControllers } from './terminal-tab-controllers'

/** Gives the keys to the active tab's focused pane, if the terminals are on screen. */
export function focusActiveTerminal(): void {
  const { activeTabId } = useTerminalStore.getState()
  const controller = activeTabId ? terminalTabControllers.get(activeTabId) : undefined
  if (controller?.isShown()) controller.focus()
}

/**
 * Runs a Terminal menu command; false when it has nothing to act on. Commands on tabs and panes
 * act only on terminals on screen: a shortcut pressed in Settings must not close a hidden shell.
 */
export function runTerminalCommand(command: TerminalCommand): boolean {
  const { tabs, activeTabId, openTerminal, cycleTab } = useTerminalStore.getState()
  const activeTab = tabs.find((tab) => tab.id === activeTabId)
  const controller = activeTab ? terminalTabControllers.get(activeTab.id) : undefined
  const shown = controller?.isShown() ?? false
  switch (command) {
    case 'new-terminal': {
      const firstFolder = useWorkspaceStore
        .getState()
        .workspace?.folders.find((folder) => !folder.missing)
      openTerminal(activeTab ? activeTab.cwd : (firstFolder?.path ?? null))
      return true
    }
    case 'next-tab':
    case 'previous-tab':
      if (!shown) return false
      cycleTab(command === 'next-tab' ? 1 : -1)
      return true
    default:
      if (!controller || !shown) return false
      controller.run(command)
      return true
  }
}

/** Terminal menu items from main, and the same shortcuts pressed while the page has the keys. */
export function useTerminalCommands(): void {
  useEffect(() => {
    connectTerminalOutput()
    const unsubscribe = window.desktop.subscribeTerminalCommand((command) => {
      runTerminalCommand(command)
    })
    // Capture phase, before xterm turns the keys into input for the shell.
    const onKeyDown = (event: KeyboardEvent): void => {
      const command = terminalCommandForKey(event, rendererPlatform)
      if (!command || !runTerminalCommand(command)) return
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      unsubscribe()
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [])
}
