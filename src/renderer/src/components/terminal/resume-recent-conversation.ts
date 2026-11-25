import { conversationKey, type RecentConversation } from '../../../../shared/recent-conversation'
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
  const reported = new Set<string>()
  for (const session of sessions) {
    if (session.process !== 'running' || !session.providerSessionId) continue
    reported.add(session.terminalId)
    if (conversationKey(session) === key && selectTerminal(session.terminalId)) return
  }
  const store = useTerminalStore.getState()
  for (const tab of store.tabs) {
    const controller = terminalTabControllers.get(tab.id)
    const target = tab.agent?.target
    if (
      controller
        ? controller.selectPendingConversation(key, reported)
        : target && 'recent' in target && target.recent.key === key
    ) {
      store.activateTab(tab.id)
      useShellLayoutStore.getState().showAgents()
      return
    }
  }
  const agent: AgentLaunch = { provider: entry.provider, target: { recent: { generation, key } } }
  if (
    split &&
    store.activeTabId &&
    terminalTabControllers.get(store.activeTabId)?.splitConversation(agent, entry.cwd)
  )
    return
  store.openTerminal(entry.cwd, agent)
}
