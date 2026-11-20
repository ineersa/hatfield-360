import type { TerminalCommand } from '../../../../shared/terminal-api'

/** Pane commands for one tab's panes; menu items and shortcuts reach the active tab through this. */
export type TerminalTabController = {
  run: (command: Exclude<TerminalCommand, 'new-terminal' | 'next-tab' | 'previous-tab'>) => void
  focus: () => void
  /** Whether the tab's panes are on screen (its tab is active and no other page covers them). */
  isShown: () => boolean
}

export const terminalTabControllers = new Map<string, TerminalTabController>()
