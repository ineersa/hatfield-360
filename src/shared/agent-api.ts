import type { RecentConversation } from './recent-conversation'
import type { TerminalSession } from './terminal-api'

export const AGENT_PROVIDERS = { hatfield: 'Hatfield', claude: 'Claude' } as const
export type AgentProvider = keyof typeof AGENT_PROVIDERS
export type AgentProfile = { executable: string; args: string[] }
type AgentTarget =
  | { project: string; cwd: string }
  | { sourceTerminalId: string }
  | { recent: { generation: number; key: string } }
  | { restore: { generation: number; paneId: string } }
export type AgentLaunch = { provider: AgentProvider; target: AgentTarget }
export type AgentSession = {
  id: string
  terminalId: string
  provider: AgentProvider
  providerSessionId: string | null
  title: string | null
  project: string | null
  worktree: string | null
  cwd: string
  process: 'running' | 'exited' | 'unknown'
  activity: 'working' | 'idle' | 'unknown'
  runningChildren: number | null
  runningScripts: number | null
  tool: string | null
  wait: 'permission' | 'question' | 'external-input' | null
  outcome: 'completed' | 'failed' | 'cancelled' | 'unknown' | null
  updatedAt: number
}
export type AgentSnapshot = {
  revision: number
  /** Oldest record first. Updating an existing record does not change its position. */
  sessions: AgentSession[]
}
export type AgentNotification = {
  ownerWindowFocusedAndVisible: boolean
  provider: AgentProvider
  providerSessionId: string
  terminalId: string
  message:
    | { kind: 'needs-input' | 'completed' | 'failed' }
    | { kind: 'explicit'; title: string; body: string }
}
export const AGENT_CHANNELS = {
  launch: 'agent:launch',
  recent: 'agent:recent',
  get: 'agent:get',
  changed: 'agent:changed',
  notification: 'agent:notification'
} as const
export type AgentApi = {
  launchAgent: (request: AgentLaunch & { cols: number; rows: number }) => Promise<TerminalSession>
  getRecentConversations: (generation: number) => Promise<RecentConversation[]>
  getAgentSessions: () => Promise<AgentSnapshot>
  subscribeAgentNotifications: (callback: (notice: AgentNotification) => void) => () => void
  subscribeAgentSessions: (callback: (snapshot: AgentSnapshot) => void) => () => void
}
