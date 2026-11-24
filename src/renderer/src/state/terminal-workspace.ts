import { create } from 'zustand'
import { AGENT_PROVIDERS, type AgentSession } from '../../../shared/agent-api'
import type {
  ResumeFailure,
  SavedConversation,
  SavedTerminalTab
} from '../../../shared/terminal-workspace-api'
import {
  selectTerminal,
  terminalTabControllers
} from '@/components/terminal/terminal-tab-controllers'
import { mainErrorMessage } from '@/lib/main-error-message'
import { notify } from './notification-store'
import { useTerminalStore } from './terminal-store'

type Restore = { session: SavedConversation; failure: ResumeFailure | null }
export const useTerminalWorkspace = create<{
  history: SavedConversation[]
  restore: Record<string, Restore>
}>(() => ({ history: [], restore: {} }))
const currentLayouts = new Map<string, SavedTerminalTab>()
let initialized = false
let initialization: Promise<void> | undefined
const openingRecent = new Set<string>()
let scheduled = false

function checkpointTerminalWorkspace(): void {
  if (!initialized || scheduled) return
  scheduled = true
  queueMicrotask(() => {
    scheduled = false
    const { tabs, activeTabId } = useTerminalStore.getState()
    const open = new Set(tabs.map((tab) => tab.id))
    for (const id of currentLayouts.keys()) if (!open.has(id)) currentLayouts.delete(id)
    const layout = tabs.flatMap((tab) => currentLayouts.get(tab.id) ?? tab.saved ?? [])
    void window.desktop
      .checkpointTerminalLayout({ tabs: layout, activeTabId })
      .catch((error: unknown) =>
        console.error('Saving terminal workspace failed:', mainErrorMessage(error))
      )
  })
}

export function checkpointTab(tab: SavedTerminalTab): void {
  currentLayouts.set(tab.id, tab)
  checkpointTerminalWorkspace()
}

export function initializeTerminalWorkspace(): Promise<void> {
  initialization ??= loadTerminalWorkspace().catch((error: unknown) => {
    initialization = undefined
    throw error
  })
  return initialization
}

async function loadTerminalWorkspace(): Promise<void> {
  const initial = await window.desktop.loadTerminalWorkspace()
  useTerminalWorkspace.setState({ history: initial.conversations })
  window.desktop.subscribeTerminalHistory((history) => useTerminalWorkspace.setState({ history }))
  const tabs = initial.layout.tabs.map((saved) => {
    let first = saved.layout
    while (first.kind === 'split') first = first.first
    const agent = initial.conversations.find((item) => item.id === first.conversation)
    return {
      id: saved.id,
      label: saved.label,
      cwd: saved.cwd,
      saved,
      title: agent ? `${AGENT_PROVIDERS[agent.provider]} · ${saved.label}` : saved.label
    }
  })
  useTerminalStore.setState({ tabs, activeTabId: initial.layout.activeTabId })
  useTerminalStore.subscribe((current, previous) => {
    if (current.tabs !== previous.tabs || current.activeTabId !== previous.activeTabId)
      checkpointTerminalWorkspace()
  })
  initialized = true
}

export function setRestore(
  pane: string,
  session: SavedConversation,
  failure: ResumeFailure | null
): void {
  useTerminalWorkspace.setState((state) => ({
    restore: { ...state.restore, [pane]: { session, failure } }
  }))
}

export function clearRestore(pane: string): void {
  useTerminalWorkspace.setState((state) => {
    const restore = { ...state.restore }
    delete restore[pane]
    return { restore }
  })
}

export function restoredSessionRow(pane: string, saved: SavedConversation): AgentSession {
  return {
    ...saved,
    id: pane,
    terminalId: pane,
    process: 'unknown',
    activity: 'unknown',
    runningChildren: null,
    runningScripts: null,
    tool: null,
    wait: null,
    outcome: null
  }
}

export async function resumeRecent(saved: SavedConversation, split: boolean): Promise<void> {
  if (selectTerminal(saved.id) || openingRecent.has(saved.id)) return
  const opening = useTerminalStore
    .getState()
    .tabs.find(
      (tab) =>
        tab.saved?.layout.kind === 'pane' &&
        tab.saved.layout.conversation === saved.id &&
        !terminalTabControllers.has(tab.id)
    )
  if (opening) {
    useTerminalStore.getState().activateTab(opening.id)
    return
  }
  openingRecent.add(saved.id)
  try {
    const { sessions } = await window.desktop.getAgentSessions()
    if (selectTerminal(saved.id)) return
    const live = sessions.find(
      (item) =>
        item.id === saved.id ||
        (item.provider === saved.provider &&
          item.providerSessionId === saved.providerSessionId &&
          (item.provider === 'claude' || item.cwd === saved.cwd))
    )
    if (live && selectTerminal(live.terminalId)) return
    const store = useTerminalStore.getState()
    if (
      split &&
      store.activeTabId &&
      terminalTabControllers.get(store.activeTabId)?.resumeSplit(saved)
    )
      return
    const id = crypto.randomUUID()
    const pane = crypto.randomUUID()
    const label = saved.cwd.split('/').findLast(Boolean) ?? saved.cwd
    store.openTerminal(
      saved.cwd,
      { provider: saved.provider, target: { cwd: saved.cwd, project: saved.project ?? saved.cwd } },
      {
        id,
        label,
        cwd: saved.cwd,
        activePane: pane,
        layout: { kind: 'pane', id: pane, conversation: saved.id }
      }
    )
  } catch (error) {
    notify({ severity: 'error', title: 'Could not resume session', body: mainErrorMessage(error) })
  } finally {
    openingRecent.delete(saved.id)
  }
}
