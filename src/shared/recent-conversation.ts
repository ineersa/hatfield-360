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

/** The conversations not already running in a pane: a resumed one leaves Recent while it runs. */
export function withoutRunning(
  recent: readonly RecentConversation[],
  live: readonly AgentSession[],
  scopeAliases: ReadonlyMap<string, string>
): RecentConversation[] {
  const running = new Set<string>()
  for (const session of live) {
    if (session.process !== 'running') continue
    for (const key of matchingConversationKeys(session, scopeAliases)) running.add(key)
  }
  if (running.size === 0) return [...recent]
  return recent.filter((entry) => {
    const key = conversationKey(entry, scopeAliases)
    return key === null || !running.has(key)
  })
}
