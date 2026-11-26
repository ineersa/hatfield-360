import type { AgentProvider, AgentSession } from '../../../../shared/agent-api'
import type { MemoryHit } from '../../../../shared/memory-search-api'
import {
  conversationKey,
  matchingConversationKeys,
  type RecentConversation
} from '../../../../shared/recent-conversation'

/** What the app knows about the session a memory came from. */
export type MemorySource =
  | { kind: 'live'; session: AgentSession }
  | { kind: 'history'; entry: RecentConversation }
  | { kind: 'unknown'; provider: AgentProvider | null }

/**
 * Matches a memory's source session to a running pane or a resumable Recent conversation in the
 * searched project. Hatfield numbers repeat across folders, so they match only in the project
 * itself (Librarian never observes linked worktrees); Claude IDs are unique but stay project-scoped.
 */
export function memorySource(
  hit: Pick<MemoryHit, 'provider' | 'sessionId'>,
  project: string,
  live: readonly AgentSession[],
  recent: readonly RecentConversation[],
  scopeAliases: ReadonlyMap<string, string>
): MemorySource {
  const { provider } = hit
  if (!provider) return { kind: 'unknown', provider }
  const keys = matchingConversationKeys(
    { provider, providerSessionId: hit.sessionId, cwd: project },
    scopeAliases
  )
  const matches = (identity: Parameters<typeof conversationKey>[0], from: string | null) => {
    const key = conversationKey(identity, scopeAliases)
    return key !== null && keys.has(key) && (provider === 'hatfield' || from === project)
  }
  const session = live.find(
    (candidate) => candidate.process === 'running' && matches(candidate, candidate.project)
  )
  if (session) return { kind: 'live', session }
  const entry = recent.find((candidate) => matches(candidate, candidate.project))
  if (entry) return { kind: 'history', entry }
  return { kind: 'unknown', provider }
}
