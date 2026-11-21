import type { TerminalSession } from './terminal-api'

export const AGENT_PROVIDERS = { hatfield: 'Hatfield', claude: 'Claude' } as const
export type AgentProvider = keyof typeof AGENT_PROVIDERS
export type AgentProfile = { executable: string; args: string[] }
type AgentTarget = { project: string; cwd: string } | { sourceTerminalId: string }
export type AgentLaunch = { provider: AgentProvider; target: AgentTarget }
export type AgentSession = {
  id: string
  terminalId: string
  provider: AgentProvider
  providerSessionId: string | null
  project: string | null
  cwd: string
  process: 'running' | 'exited'
  activity: 'working' | 'idle' | 'unknown'
  tool: string | null
  wait: 'permission' | 'question' | 'external-input' | null
  outcome: 'completed' | 'failed' | 'cancelled' | 'unknown' | null
  updatedAt: number
}
export type AgentSnapshot = { revision: number; sessions: AgentSession[] }
export const AGENT_CHANNELS = {
  launch: 'agent:launch',
  get: 'agent:get',
  changed: 'agent:changed'
} as const
export type AgentApi = {
  launchAgent: (request: AgentLaunch & { cols: number; rows: number }) => Promise<TerminalSession>
  getAgentSessions: () => Promise<AgentSnapshot>
  subscribeAgentSessions: (callback: (snapshot: AgentSnapshot) => void) => () => void
}
