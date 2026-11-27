import type { SavedTerminalTab } from '../../../shared/terminal-workspace-api'
import { AGENT_PROVIDERS, type AgentLaunch } from '../../../shared/agent-api'
import { create } from 'zustand'
import { useShellLayoutStore } from './shell-layout-store'
import { useAgentSessionStore } from './agent-session-store'
import { pinnedTabIds, stripOrder } from './pinned-sessions'

export type TerminalTab = {
  id: string
  /** Visible label: the folder the tab started in. */
  label: string
  /** Accessible name; an agent tab also names its provider, which the strip shows as an icon. */
  title: string
  /** The folder new shells in this tab start in; null for the home folder. */
  cwd: string | null
  agent?: AgentLaunch
  saved?: SavedTerminalTab
  generation?: number
}

type TerminalState = {
  paneByTab: Record<string, string | null>
  setActivePane: (tabId: string, id: string | null) => void
  tabs: TerminalTab[]
  activeTabId: string | null
  /** The terminals each tab's panes run, as their shells start and end. */
  tabTerminals: Record<string, string[]>
  setTabTerminals: (tabId: string, ids: string[]) => void
  /** Pinned conversations, by `pinKey`; saved with the workspace. */
  pinned: string[]
  setPinned: (key: string, pinned: boolean) => void
  /** Opens a tab with one shell and shows it in the Agents view. */
  openTerminal: (cwd: string | null, agent?: AgentLaunch) => void
  /** Removes the tab; its panes' shells end as the tab unmounts. */
  closeTab: (id: string) => void
  activateTab: (id: string) => void
  cycleTab: (step: 1 | -1) => void
}

function folderName(path: string): string {
  return path.split(/[\\/]/).findLast((part) => part.length > 0) ?? path
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  paneByTab: {},
  setActivePane: (tabId, id) =>
    set((state) => ({ paneByTab: { ...state.paneByTab, [tabId]: id } })),
  tabs: [],
  activeTabId: null,
  tabTerminals: {},
  setTabTerminals: (tabId, ids) =>
    set((state) => {
      const current = state.tabTerminals[tabId]
      if (current?.length === ids.length && current.every((id, index) => id === ids[index]))
        return state
      return { tabTerminals: { ...state.tabTerminals, [tabId]: ids } }
    }),
  pinned: [],
  setPinned: (key, pinned) =>
    set((state) =>
      state.pinned.includes(key) === pinned
        ? state
        : { pinned: pinned ? [...state.pinned, key] : state.pinned.filter((item) => item !== key) }
    ),
  openTerminal: (cwd, agent) => {
    const label = cwd ? folderName(cwd) : 'Terminal'
    const tab: TerminalTab = {
      id: crypto.randomUUID(),
      label,
      title: agent ? `${AGENT_PROVIDERS[agent.provider]} · ${label}` : label,
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
      const tabTerminals = { ...state.tabTerminals }
      delete tabTerminals[id]
      return { tabs, activeTabId, paneByTab, tabTerminals }
    })
  },
  activateTab: (id) => set({ activeTabId: id }),
  cycleTab: (step) => {
    const { activeTabId, tabTerminals, pinned } = get()
    const sessions = useAgentSessionStore.getState().sessions
    const tabs = stripOrder(get().tabs, pinnedTabIds(tabTerminals, sessions, pinned))
    if (tabs.length < 2) return
    const index = tabs.findIndex((tab) => tab.id === activeTabId)
    const next = tabs[(index + step + tabs.length) % tabs.length]
    if (next) set({ activeTabId: next.id })
  }
}))
