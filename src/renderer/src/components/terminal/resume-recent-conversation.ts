import { useRecentSessionStore } from '@/state/recent-session-store'
import {
  conversationKey,
  matchingConversationKeys,
  type RecentConversation
} from '../../../../shared/recent-conversation'
import type { AgentLaunch, AgentSession } from '../../../../shared/agent-api'
import { useTerminalStore } from '@/state/terminal-store'
import { useShellLayoutStore } from '@/state/shell-layout-store'
import { selectTerminal, terminalTabControllers } from './terminal-tab-controllers'

export function resumeRecentConversation(
  entry: RecentConversation,
  generation: number,
  split: boolean,
  sessions: AgentSession[]
): void {
  const key = conversationKey(entry)
  if (!key) return
  const aliases = useRecentSessionStore.getState().catalog?.scopeAliases
  const keys = aliases ? matchingConversationKeys(entry, aliases) : new Set([key])
  const reported = new Set<string>()
  for (const session of sessions) {
    if (session.process !== 'running' || !session.providerSessionId) continue
    reported.add(session.terminalId)
    const liveKey = conversationKey(session)
    if (liveKey !== null && keys.has(liveKey) && selectTerminal(session.terminalId)) return
  }
  const store = useTerminalStore.getState()
  for (const tab of store.tabs) {
    const controller = terminalTabControllers.get(tab.id)
    const target = tab.agent?.target
    if (
      controller
        ? controller.selectPendingConversation(keys, reported)
        : target && 'recent' in target && keys.has(target.recent.key)
    ) {
      store.activateTab(tab.id)
      useShellLayoutStore.getState().showAgents()
      return
    }
  }
  const agent: AgentLaunch = { provider: entry.provider, target: { recent: { generation, key } } }
  const cwd = entry.resumeCwd ?? entry.cwd
  if (
    split &&
    store.activeTabId &&
    terminalTabControllers.get(store.activeTabId)?.splitConversation(agent, cwd)
  )
    return
  store.openTerminal(cwd, agent)
}
