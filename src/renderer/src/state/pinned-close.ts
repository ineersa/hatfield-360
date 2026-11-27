import type { AgentSession } from '../../../shared/agent-api'
import { pinKey } from '../../../shared/pinned-session'
import { create } from 'zustand'
import { useAgentSessionStore } from './agent-session-store'
import { pinnedIn } from './pinned-sessions'
import { useTerminalStore } from './terminal-store'

type PendingClose = { sessions: AgentSession[]; close: () => void }

/** A close that would end pinned sessions, waiting for the user's answer. */
export const usePinnedCloseStore = create<{ pending: PendingClose | null }>(() => ({
  pending: null
}))

/** Closes at once, or first asks when these terminals run pinned sessions. */
export function closeUnlessPinned(terminalIds: readonly string[], close: () => void): void {
  const sessions = pinnedIn(
    terminalIds,
    useAgentSessionStore.getState().sessions,
    useTerminalStore.getState().pinned
  )
  if (sessions.length === 0) close()
  else usePinnedCloseStore.setState({ pending: { sessions, close } })
}

/** The user's answer: Unpin and Close, or Keep Open. */
export function answerPinnedClose(close: boolean): void {
  const { pending } = usePinnedCloseStore.getState()
  usePinnedCloseStore.setState({ pending: null })
  if (!pending || !close) return
  const { setPinned } = useTerminalStore.getState()
  for (const session of pending.sessions) {
    const key = pinKey(session)
    if (key) setPinned(key, false)
  }
  pending.close()
}
