import type { AgentProvider, AgentSession } from './agent-api'

export const RECENT_CONVERSATION_MS = 14 * 24 * 60 * 60 * 1000

type Identity = {
  provider: AgentProvider
  providerSessionId: string | null
  cwd: string | null
  resumeCwd?: string
}

export type RecentConversation = Pick<AgentSession, 'provider' | 'project' | 'title'> & {
  providerSessionId: string
  cwd: string | null
  resumeCwd?: string
  branch: string | null
  lastModified: number
}

export type RecentCatalog = { sessions: RecentConversation[]; errors: string[] }

export function conversationKey({
  provider,
  providerSessionId,
  cwd,
  resumeCwd
}: Identity): string | null {
  if (!providerSessionId) return null
  return JSON.stringify([
    provider,
    provider === 'claude' ? providerSessionId.toLowerCase() : providerSessionId,
    provider === 'hatfield' ? (resumeCwd ?? cwd) : null
  ])
}
