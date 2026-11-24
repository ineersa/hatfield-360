import type { AgentSession } from './agent-api'
import type { TerminalSession } from './terminal-api'

export type SavedConversation = Pick<
  AgentSession,
  | 'id'
  | 'provider'
  | 'providerSessionId'
  | 'title'
  | 'project'
  | 'worktree'
  | 'cwd'
  | 'process'
  | 'activity'
  | 'updatedAt'
> & { branch: string | null; closedAt: number | null }

export type PaneLayout =
  | { kind: 'pane'; id: string; conversation: string | null; terminalId?: string }
  | {
      kind: 'split'
      direction: 'vertical' | 'horizontal'
      ratio: number
      first: PaneLayout
      second: PaneLayout
    }

export type SavedTerminalTab = {
  id: string
  cwd: string | null
  label: string
  activePane: string | null
  layout: PaneLayout
}
export type TerminalLayout = { tabs: SavedTerminalTab[]; activeTabId: string | null }
export type TerminalWorkspace = { layout: TerminalLayout; conversations: SavedConversation[] }
export type ResumeFailure = { reason: string; detail: string; settings: boolean }
export type ResumeResult = { terminal: TerminalSession } | { failure: ResumeFailure }

export const TERMINAL_WORKSPACE_CHANNELS = {
  load: 'terminal-workspace:load',
  checkpoint: 'terminal-workspace:checkpoint',
  history: 'terminal-workspace:history',
  forget: 'terminal-workspace:forget',
  resume: 'terminal-workspace:resume'
} as const

export type TerminalWorkspaceApi = {
  loadTerminalWorkspace: () => Promise<TerminalWorkspace>
  checkpointTerminalLayout: (layout: TerminalLayout) => Promise<void>
  subscribeTerminalHistory: (callback: (history: SavedConversation[]) => void) => () => void
  forgetTerminalConversation: (id: string) => Promise<void>
  resumeTerminalConversation: (id: string, cols: number, rows: number) => Promise<ResumeResult>
}
