import { checkpointTab, currentTerminalGeneration } from '@/state/terminal-workspace'
import { closeUnlessPinned } from '@/state/pinned-close'
import { conversationKey } from '../../../../shared/recent-conversation'
import type { PaneLeaf } from '../../../../shared/terminal-workspace-api'
import type { ManagedPane } from '@/lib/pane-manager/pane-manager-types'
import type { AgentLaunch } from '../../../../shared/agent-api'
import { useEffect, useRef } from 'react'
import { PaneManager } from '@/lib/pane-manager/pane-manager'
import { terminalShortcutLabel } from '@/lib/keymap-match'
import { useKeymapStore } from '@/state/keymap-store'
import { useTerminalStore, type TerminalTab } from '@/state/terminal-store'
import { startPaneShell, type PaneShell } from './pane-shell'
import {
  currentGpuAcceleration,
  currentTerminalOptions,
  useTerminalAppearance
} from './terminal-appearance'
import { bindClipboardKeys } from './terminal-clipboard'
import { TerminalContextMenu } from './TerminalContextMenu'
import { openTerminalLink } from './terminal-link'
import { terminalTabControllers } from './terminal-tab-controllers'

/** One tab's split panes; mounted while the tab is open, so its shells live while it is hidden. */
export function TerminalTabBody({
  tab,
  active,
  shown
}: {
  tab: TerminalTab
  /** The tab chosen in the strip. */
  active: boolean
  /** Active and on screen: no other page (Settings, another view) covers the terminals. */
  shown: boolean
}): React.JSX.Element {
  const root = useRef<HTMLDivElement>(null)
  const isShown = useRef(shown)
  const manager = useRef<PaneManager | null>(null)

  useEffect(() => {
    const element = root.current
    if (!element) return undefined
    const shells = new Map<number, PaneShell>()
    const closeTab = useTerminalStore.getState().closeTab
    const owner = tab.generation ?? currentTerminalGeneration()
    const leaves = new Map<string, PaneLeaf>()
    const checkpoint = () => {
      useTerminalStore.getState().setTabTerminals(
        tab.id,
        panes.getPanes().flatMap(({ container }) => container.dataset.terminalId ?? [])
      )
      const layout = panes.layout((container) => {
        const id = container.dataset.layoutId ?? crypto.randomUUID()
        const leaf = leaves.get(id) ?? { kind: 'pane', id, cwd: tab.cwd }
        return {
          ...leaf,
          ...(container.dataset.terminalId ? { terminalId: container.dataset.terminalId } : {})
        }
      })
      if (layout)
        checkpointTab(owner, {
          id: tab.id,
          label: tab.label,
          cwd: tab.cwd,
          activePane: panes.getActivePane()?.container.dataset.layoutId ?? null,
          layout
        })
    }
    const publishActivePane = () => {
      useTerminalStore
        .getState()
        .setActivePane(tab.id, panes.getActivePane()?.container.dataset.terminalId ?? null)
      checkpoint()
    }
    let nextLaunch = tab.agent
    let nextCwd = tab.cwd
    const create = (pane: ManagedPane, saved?: PaneLeaf) => {
      const leaf = saved ?? { kind: 'pane', id: crypto.randomUUID(), cwd: nextCwd }
      pane.container.dataset.layoutId = leaf.id
      leaves.set(leaf.id, leaf)
      const agent: AgentLaunch | undefined =
        saved?.agent && owner !== undefined
          ? {
              provider: saved.agent.provider,
              target: { restore: { generation: owner, paneId: leaf.id } }
            }
          : nextLaunch
      nextLaunch = undefined
      if (agent && 'recent' in agent.target)
        pane.container.dataset.pendingConversation = agent.target.recent.key
      else if (saved?.agent) {
        const key = conversationKey({ ...saved.agent, cwd: saved.cwd })
        if (key) pane.container.dataset.pendingConversation = key
      }
      bindClipboardKeys(pane.terminal)
      shells.set(
        pane.id,
        startPaneShell(
          pane,
          leaf.cwd,
          () => panes.closePane(pane.id),
          agent,
          publishActivePane,
          Boolean(saved) || Boolean(agent && 'recent' in agent.target)
        )
      )
      checkpoint()
    }
    const panes = new PaneManager(
      element,
      {
        terminalOptions: currentTerminalOptions,
        gpuAcceleration: currentGpuAcceleration,
        onActivePaneChange: publishActivePane,
        onPaneCreated: create,
        onPaneClosed: (paneId) => {
          shells.get(paneId)?.dispose()
          shells.delete(paneId)
          if (panes.getPanes().length === 0) closeTab(tab.id)
          else checkpoint()
        },
        closePaneTitle: `Close Pane (${terminalShortcutLabel(useKeymapStore.getState().shell, 'close-pane')})`,
        requestClosePane: (paneId) => requestClosePane(paneId),
        onLinkClick: openTerminalLink
      },
      checkpoint
    )
    manager.current = panes
    // A pane running a pinned session closes only once the user confirms.
    const requestClosePane = (paneId: number) => {
      const terminalId = panes.getPanes().find((pane) => pane.id === paneId)?.container
        .dataset.terminalId
      closeUnlessPinned(terminalId ? [terminalId] : [], () => panes.closePane(paneId))
    }
    if (tab.saved) panes.restore(tab.saved.layout, tab.saved.activePane, create)
    else panes.createInitialPane()
    const findTerminal = (id: string) =>
      panes.getPanes().find((item) => item.container.dataset.terminalId === id)
    terminalTabControllers.set(tab.id, {
      hasTerminal: (id) => findTerminal(id) !== undefined,
      run: (command) => {
        const activePane = panes.getActivePane()
        if (command === 'focus-next-pane') panes.focusSibling(1)
        else if (command === 'focus-previous-pane') panes.focusSibling(-1)
        else if (!activePane) return
        else if (command === 'split-right') panes.splitPane(activePane.id, 'vertical')
        else if (command === 'split-down') panes.splitPane(activePane.id, 'horizontal')
        else requestClosePane(activePane.id)
      },
      closeTerminal: (id) => {
        const pane = findTerminal(id)
        if (!pane) return false
        requestClosePane(pane.id)
        return true
      },
      selectTerminal: (id) => {
        const pane = findTerminal(id)
        if (!pane) return false
        panes.setActivePane(pane.id, isShown.current)
        return true
      },
      selectPendingConversation: (keys, reported) => {
        const pane = panes
          .getPanes()
          .find(
            ({ container: { dataset } }) =>
              dataset.pendingConversation !== undefined &&
              keys.has(dataset.pendingConversation) &&
              !dataset.exited &&
              (!dataset.terminalId || !reported.has(dataset.terminalId))
          )
        if (!pane) return false
        panes.setActivePane(pane.id, isShown.current)
        return true
      },
      splitConversation: (agent, cwd) => {
        const pane = panes.getActivePane()
        if (!pane) return false
        nextLaunch = agent
        nextCwd = cwd
        try {
          return panes.splitPane(pane.id, 'vertical') !== null
        } finally {
          nextLaunch = undefined
          nextCwd = tab.cwd
        }
      },
      launchSplit: (provider) => {
        const pane = panes.getActivePane()
        const sourceTerminalId = pane?.container.dataset.terminalId
        if (!pane || !sourceTerminalId || pane.container.dataset.exited) return
        nextLaunch = { provider, target: { sourceTerminalId } } satisfies AgentLaunch
        try {
          panes.splitPane(pane.id, 'vertical')
        } finally {
          nextLaunch = undefined
        }
      },
      focus: () => panes.getActivePane()?.terminal.focus(),
      activeCwd: () => {
        const id = panes.getActivePane()?.container.dataset.layoutId
        return (id === undefined ? undefined : leaves.get(id)?.cwd) ?? tab.cwd
      },
      isShown: () => isShown.current
    })
    return () => {
      terminalTabControllers.delete(tab.id)
      for (const shell of shells.values()) shell.dispose()
      shells.clear()
      panes.destroy()
      manager.current = null
    }
  }, [tab])

  useTerminalAppearance(manager)

  useEffect(() => {
    isShown.current = shown
  }, [shown])

  // Showing the terminals again (a tab chosen, back from Settings or another view) gives them the keys.
  useEffect(() => {
    if (shown) terminalTabControllers.get(tab.id)?.focus()
  }, [shown, tab.id])

  return (
    <TerminalContextMenu
      activeTerminal={() => manager.current?.getActivePane()?.terminal ?? null}
      launchSplit={(provider) => terminalTabControllers.get(tab.id)?.launchSplit(provider)}
      canLaunch={() => {
        const pane = manager.current?.getActivePane()
        return Boolean(pane?.container.dataset.terminalId && !pane.container.dataset.exited)
      }}
      runCommand={(command) => terminalTabControllers.get(tab.id)?.run(command)}
      rearrangePanes={() => manager.current?.startRearrange()}
      canRearrange={() => (manager.current?.getPanes().length ?? 0) > 1}
    >
      <div
        ref={root}
        role="tabpanel"
        aria-label={tab.title}
        data-testid="terminal-tab-panel"
        className="min-h-0 flex-1 rounded-b-island"
        hidden={!active}
      />
    </TerminalContextMenu>
  )
}
