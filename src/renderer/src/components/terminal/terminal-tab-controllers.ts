import { useShellLayoutStore } from '@/state/shell-layout-store'
import { useTerminalStore } from '@/state/terminal-store'
import type { AgentProvider } from '../../../../shared/agent-api'
import type { TerminalCommand } from '../../../../shared/terminal-api'

/** Pane commands for one tab's panes; menu items and shortcuts reach the active tab through this. */
export type TerminalTabController = {
  run: (command: Exclude<TerminalCommand, 'new-terminal' | 'next-tab' | 'previous-tab'>) => void
  hasTerminal: (id: string) => boolean
  closeTerminal: (id: string) => boolean
  selectTerminal: (id: string) => boolean
  launchSplit: (provider: AgentProvider) => void
  focus: () => void
  /** Whether the tab's panes are on screen (its tab is active and no other page covers them). */
  isShown: () => boolean
}

export const terminalTabControllers = new Map<string, TerminalTabController>()

export function selectTerminal(id: string): boolean {
  for (const [tabId, controller] of terminalTabControllers) {
    if (!controller.selectTerminal(id)) continue
    useTerminalStore.getState().activateTab(tabId)
    useShellLayoutStore.getState().showAgents()
    return true
  }
  return false
}

export function isTerminalShown(id: string): boolean {
  const { activeTabId } = useTerminalStore.getState()
  const { activeView, settingsOpen } = useShellLayoutStore.getState()
  if (!activeTabId || activeView !== 'agents' || settingsOpen) return false
  const controller = terminalTabControllers.get(activeTabId)
  return controller?.isShown() === true && controller.hasTerminal(id)
}

export function closeTerminal(id: string): boolean {
  for (const controller of terminalTabControllers.values()) {
    if (controller.closeTerminal(id)) return true
  }
  return false
}
