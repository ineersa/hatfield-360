import type { AgentSession } from './agent-api'

type SavedAgent = Pick<AgentSession, 'provider' | 'providerSessionId' | 'title' | 'project'> & {
  branch?: string | null
}
export type PaneLeaf = {
  kind: 'pane'
  id: string
  cwd: string | null
  agent?: SavedAgent
  terminalId?: string
}
export type PaneLayout =
  | PaneLeaf
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
