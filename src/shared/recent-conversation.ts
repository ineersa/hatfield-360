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

export type RecentCatalog = {
  sessions: RecentConversation[]
  errors: string[]
  scopeAliases: Map<string, string>
}

export function conversationKey(
  { provider, providerSessionId, cwd, resumeCwd }: Identity,
  scopeAliases?: ReadonlyMap<string, string>
): string | null {
  if (!providerSessionId) return null
  const scope = resumeCwd ?? cwd
  return JSON.stringify([
    provider,
    provider === 'claude' ? providerSessionId.toLowerCase() : providerSessionId,
    provider === 'hatfield' && scope !== null ? (scopeAliases?.get(scope) ?? scope) : null
  ])
}

export function matchingConversationKeys(
  identity: Identity,
  scopeAliases: ReadonlyMap<string, string>
): Set<string> {
  const keys = new Set<string>()
  const key = conversationKey(identity, scopeAliases)
  if (key === null) return keys
  keys.add(key)
  if (identity.provider === 'hatfield') {
    const scope = identity.resumeCwd ?? identity.cwd
    const canonical = scope === null ? null : (scopeAliases.get(scope) ?? scope)
    for (const [alias, destination] of scopeAliases) {
      if (destination === canonical) {
        const aliasKey = conversationKey({ ...identity, resumeCwd: alias })
        if (aliasKey !== null) keys.add(aliasKey)
      }
    }
  }
  return keys
}
