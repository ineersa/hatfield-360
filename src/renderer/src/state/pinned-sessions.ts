import type { AgentSession } from '../../../shared/agent-api'
import { pinKey } from '../../../shared/pinned-session'

/** Whether a live session is pinned; an exited one leaves its pin to the saved layout. */
export function isPinned(session: AgentSession, pinned: readonly string[]): boolean {
  if (session.process !== 'running') return false
  const key = pinKey(session)
  return key !== null && pinned.includes(key)
}

/** The running pinned sessions whose terminals are in these panes. */
export function pinnedIn(
  terminalIds: readonly string[],
  sessions: readonly AgentSession[],
  pinned: readonly string[]
): AgentSession[] {
  return sessions.filter(
    (session) => terminalIds.includes(session.terminalId) && isPinned(session, pinned)
  )
}

/** Tabs holding a pinned session in any of their panes. */
export function pinnedTabIds(
  tabTerminals: Readonly<Record<string, readonly string[]>>,
  sessions: readonly AgentSession[],
  pinned: readonly string[]
): Set<string> {
  const ids = new Set<string>()
  if (pinned.length === 0) return ids
  for (const [tabId, terminals] of Object.entries(tabTerminals))
    if (pinnedIn(terminals, sessions, pinned).length > 0) ids.add(tabId)
  return ids
}

/** The strip's order: pinned tabs first, each run keeping the order the tabs were opened in. */
export function stripOrder<T extends { id: string }>(tabs: readonly T[], pinned: Set<string>): T[] {
  return [...tabs.filter((tab) => pinned.has(tab.id)), ...tabs.filter((tab) => !pinned.has(tab.id))]
}
