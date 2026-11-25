import type { AgentProvider, AgentSession } from './agent-api'

export const RECENT_CONVERSATION_MS = 14 * 24 * 60 * 60 * 1000

type Identity = { provider: AgentProvider; providerSessionId: string | null; cwd: string | null }

export type RecentConversation = Pick<AgentSession, 'provider' | 'project' | 'title'> & {
  providerSessionId: string
  cwd: string | null
  branch: string | null
  lastModified: number
}

export function conversationKey({ provider, providerSessionId, cwd }: Identity): string | null {
  if (!providerSessionId) return null
  return JSON.stringify([
    provider,
    provider === 'claude' ? providerSessionId.toLowerCase() : providerSessionId,
    provider === 'hatfield' ? cwd : null
  ])
}
