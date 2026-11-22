import { AGENT_PROVIDERS, type AgentLaunch } from '../../../shared/agent-api'
import { create } from 'zustand'
import { useShellLayoutStore } from './shell-layout-store'

export type TerminalTab = {
  id: string
  title: string
  /** The folder new shells in this tab start in; null for the home folder. */
  cwd: string | null
  agent?: AgentLaunch
}

type TerminalState = {
  paneByTab: Record<string, string | null>
  setActivePane: (tabId: string, id: string | null) => void
  tabs: TerminalTab[]
  activeTabId: string | null
  /** Opens a tab with one shell and shows it in the Agents view. */
  openTerminal: (cwd: string | null, agent?: AgentLaunch) => void
  /** Removes the tab; its panes' shells end as the tab unmounts. */
  closeTab: (id: string) => void
  activateTab: (id: string) => void
  cycleTab: (step: 1 | -1) => void
}

let nextTabNumber = 1

function folderName(path: string): string {
  return path.split(/[\\/]/).findLast((part) => part.length > 0) ?? path
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  paneByTab: {},
  setActivePane: (tabId, id) =>
    set((state) => ({ paneByTab: { ...state.paneByTab, [tabId]: id } })),
  tabs: [],
  activeTabId: null,
  openTerminal: (cwd, agent) => {
    const tab: TerminalTab = {
      id: `terminal-tab-${nextTabNumber++}`,
      title: agent ? AGENT_PROVIDERS[agent.provider] : cwd ? folderName(cwd) : 'Terminal',
      cwd,
      ...(agent ? { agent } : {})
    }
    set((state) => ({ tabs: [...state.tabs, tab], activeTabId: tab.id }))
    useShellLayoutStore.getState().showAgents()
  },
  closeTab: (id) => {
    set((state) => {
      const index = state.tabs.findIndex((tab) => tab.id === id)
      if (index === -1) return state
      const tabs = state.tabs.filter((tab) => tab.id !== id)
      // The neighbour to the left takes over, as in browsers and IDEs.
      const neighbour = tabs[Math.max(0, index - 1)]
      const activeTabId = state.activeTabId === id ? (neighbour?.id ?? null) : state.activeTabId
      const paneByTab = { ...state.paneByTab }
      delete paneByTab[id]
      return { tabs, activeTabId, paneByTab }
    })
  },
  activateTab: (id) => set({ activeTabId: id }),
  cycleTab: (step) => {
    const { tabs, activeTabId } = get()
    if (tabs.length < 2) return
    const index = tabs.findIndex((tab) => tab.id === activeTabId)
    const next = tabs[(index + step + tabs.length) % tabs.length]
    if (next) set({ activeTabId: next.id })
  }
}))
