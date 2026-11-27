import type { AgentSession, AgentSnapshot } from '../../../shared/agent-api'
import { create } from 'zustand'
import { mainErrorMessage } from '@/lib/main-error-message'

type AgentSessionState = {
  snapshot: AgentSnapshot
  /** Newest record first, as the panel lists them. */
  sessions: AgentSession[]
  error: string | null
}

export const useAgentSessionStore = create<AgentSessionState>(() => ({
  snapshot: { revision: -1, sessions: [] },
  sessions: [],
  error: null
}))

function receive(next: AgentSnapshot): void {
  if (next.revision <= useAgentSessionStore.getState().snapshot.revision) return
  useAgentSessionStore.setState({
    snapshot: next,
    sessions: next.sessions.toReversed(),
    error: null
  })
}

/** Follows main's agent sessions for the window's lifetime; every view reads the same snapshot. */
export function connectAgentSessions(): void {
  window.desktop.subscribeAgentSessions(receive)
  void window.desktop
    .getAgentSessions()
    .then(receive, (failure: unknown) =>
      useAgentSessionStore.setState({ error: mainErrorMessage(failure) })
    )
}
