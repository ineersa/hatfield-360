import type { SavedTerminalTab } from '../../../shared/terminal-workspace-api'
import type { WorkspaceView } from '../../../shared/workspace-api'
import { mainErrorMessage } from '@/lib/main-error-message'
import { notify } from './notification-store'
import { useTerminalStore } from './terminal-store'

let generation: number | undefined
const tabs = new Map<string, SavedTerminalTab>()
let queued = false

export function hydrateTerminals(workspace: WorkspaceView): void {
  if (generation === workspace.terminalGeneration) return
  generation = workspace.terminalGeneration
  tabs.clear()
  for (const tab of workspace.terminals?.tabs ?? []) tabs.set(tab.id, tab)
  useTerminalStore.setState({
    tabs: [...tabs.values()].map((tab) => ({
      id: tab.id,
      label: tab.label,
      cwd: tab.cwd,
      title: tab.label,
      saved: tab,
      generation: workspace.terminalGeneration
    })),
    paneByTab: {},
    activeTabId: workspace.terminals?.activeTabId ?? null
  })
}

export function checkpointTab(owner: number | undefined, tab: SavedTerminalTab): void {
  if (owner !== generation) return
  tabs.set(tab.id, tab)
  checkpointTerminals()
}

function checkpointTerminals(): void {
  if (queued || generation === undefined) return
  const owner = generation
  queued = true
  queueMicrotask(() => {
    queued = false
    if (owner !== generation) return
    const state = useTerminalStore.getState()
    const open = new Set(state.tabs.map((tab) => tab.id))
    for (const id of tabs.keys()) if (!open.has(id)) tabs.delete(id)
    void window.desktop
      .checkpointTerminals(owner, {
        tabs: state.tabs.flatMap(({ id }) => tabs.get(id) ?? []),
        activeTabId: state.activeTabId
      })
      .catch((error: unknown) =>
        notify({
          severity: 'error',
          title: 'Could not save terminals',
          body: mainErrorMessage(error)
        })
      )
  })
}

export function connectTerminalWorkspace(): void {
  window.desktop.subscribeAgentSessions(checkpointTerminals)
  useTerminalStore.subscribe((state, previous) => {
    if (state.tabs !== previous.tabs || state.activeTabId !== previous.activeTabId)
      checkpointTerminals()
  })
}

export function currentTerminalGeneration(): number | undefined {
  return generation
}
