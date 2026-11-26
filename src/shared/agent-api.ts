import type { TerminalSession } from './terminal-api'

export const AGENT_PROVIDERS = { hatfield: 'Hatfield', claude: 'Claude' } as const
export type AgentProvider = keyof typeof AGENT_PROVIDERS
export type AgentProfile = { executable: string; args: string[] }
type AgentTarget =
  | { project: string; cwd: string }
  | { sourceTerminalId: string }
  | { restore: { generation: number; paneId: string } }
export type AgentLaunch = { provider: AgentProvider; target: AgentTarget }
export type AgentSchedule = {
  /** Plain text, such as "Every 5 minutes" or a cron expression. */
  label: string
  recurring: boolean
  /** Epoch milliseconds, or null when the provider can't predict it. */
  nextRunAt: number | null
}
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
  /** Null when the provider doesn't report schedules. */
  schedules: AgentSchedule[] | null
  /** What started the latest reported turn. */
  trigger: 'user' | 'schedule' | null
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
    | { kind: 'needs-input' | 'failed' }
    /** `response` is the final assistant text the provider reported, up to 2,000 Unicode scalar values. */
    | { kind: 'completed'; response: string | null }
    | { kind: 'explicit'; title: string; body: string }
}
export const AGENT_CHANNELS = {
  launch: 'agent:launch',
  get: 'agent:get',
  changed: 'agent:changed',
  notification: 'agent:notification'
} as const
export type AgentApi = {
  launchAgent: (request: AgentLaunch & { cols: number; rows: number }) => Promise<TerminalSession>
  getAgentSessions: () => Promise<AgentSnapshot>
  subscribeAgentNotifications: (callback: (notice: AgentNotification) => void) => () => void
  subscribeAgentSessions: (callback: (snapshot: AgentSnapshot) => void) => () => void
}
