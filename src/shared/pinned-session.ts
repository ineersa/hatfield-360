import type { AgentSession } from './agent-api'

/**
 * Names a pinned conversation: it follows the conversation across resume and restart, not the
 * pane it runs in. Hatfield numbers its sessions per project, so the project is part of it.
 */
export function pinKey({
  provider,
  providerSessionId,
  project
}: Pick<AgentSession, 'provider' | 'providerSessionId' | 'project'>): string | null {
  if (!providerSessionId) return null
  return JSON.stringify([
    provider,
    provider === 'claude' ? providerSessionId.toLowerCase() : providerSessionId,
    provider === 'hatfield' ? project : null
  ])
}
