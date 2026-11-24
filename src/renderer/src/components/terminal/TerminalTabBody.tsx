import { discardTerminalOutput } from '@/lib/terminal-output-router'
import { createPortal } from 'react-dom'
import { RestoreFailurePane } from './RestoreFailurePane'
import {
  checkpointTab,
  clearRestore,
  setRestore,
  useTerminalWorkspace
} from '@/state/terminal-workspace'
import type { PaneLayout, SavedConversation } from '../../../../shared/terminal-workspace-api'
import type { ManagedPane } from '@/lib/pane-manager/pane-manager-types'
import { notify } from '@/state/notification-store'
import { mainErrorMessage } from '@/lib/main-error-message'
import type { AgentLaunch } from '../../../../shared/agent-api'
import type { ITerminalOptions } from '@xterm/xterm'
import { useEffect, useRef, useState } from 'react'
import { PaneManager } from '@/lib/pane-manager/pane-manager'
import { terminalShortcutLabel } from '@/lib/keymap-match'
import { useKeymapStore } from '@/state/keymap-store'
import { terminalTheme } from '@/lib/terminal-theme'
import { useSettingsStore } from '@/state/settings-store'
import { useTerminalStore, type TerminalTab } from '@/state/terminal-store'
import { startPaneShell, type PaneShell } from './pane-shell'
import { bindClipboardKeys } from './terminal-clipboard'
import { TerminalContextMenu } from './TerminalContextMenu'
import { terminalTabControllers } from './terminal-tab-controllers'

function currentTerminalOptions(): ITerminalOptions {
  const { values } = useSettingsStore.getState()
  return {
    fontFamily: values['terminal.fontFamily'],
    fontSize: values['terminal.fontSize'],
    lineHeight: values['terminal.lineHeight'],
    theme: terminalTheme(values['terminal.colorTheme'])
  }
}

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
  const [recovery, setRecovery] = useState<
    { pane: ManagedPane; retry: (() => void) | null; close: () => void }[]
  >([])
  const root = useRef<HTMLDivElement>(null)
  const isShown = useRef(shown)
  const manager = useRef<PaneManager | null>(null)
  const fontFamily = useSettingsStore((state) => state.values['terminal.fontFamily'])
  const fontSize = useSettingsStore((state) => state.values['terminal.fontSize'])
  const lineHeight = useSettingsStore((state) => state.values['terminal.lineHeight'])
  const gpuAcceleration = useSettingsStore((state) => state.values['terminal.gpuAcceleration'])
  const colorTheme = useSettingsStore((state) => state.values['terminal.colorTheme'])

  useEffect(() => {
    const element = root.current
    if (!element) return undefined
    const shells = new Map<number, PaneShell>()
    const closeTab = useTerminalStore.getState().closeTab
    const publishActivePane = () => {
      const activeDataset = panes.getActivePane()?.container.dataset
      useTerminalStore
        .getState()
        .setActivePane(tab.id, activeDataset?.terminalId ?? activeDataset?.layoutId ?? null)
      checkpoint()
    }
    const checkpoint = () => {
      const layout = panes.layout((leaf) => ({
        kind: 'pane',
        id: leaf.dataset.layoutId ?? crypto.randomUUID(),
        conversation: leaf.dataset.conversation ?? null,
        ...(leaf.dataset.terminalId ? { terminalId: leaf.dataset.terminalId } : {})
      }))
      if (layout)
        checkpointTab({
          id: tab.id,
          label: tab.label,
          cwd: tab.cwd,
          activePane: panes.getActivePane()?.container.dataset.layoutId ?? null,
          layout
        })
    }
    const recoveryIds = new Map<number, string>()
    const mountRecovery = (pane: ManagedPane, id: string) => {
      const saved = useTerminalWorkspace.getState().history.find((item) => item.id === id)
      const paneKey = pane.container.dataset.layoutId ?? id
      recoveryIds.set(pane.id, paneKey)
      const retry = saved
        ? () => {
            shells.get(pane.id)?.dispose()
            setRestore(paneKey, saved, null)
            let cancelled = false
            const attempt = crypto.randomUUID()
            const shell = startPaneShell(
              pane,
              saved.cwd,
              () => panes.closePane(pane.id),
              undefined,
              () => {
                clearRestore(paneKey)
                setRecovery((current) => current.filter((item) => item.pane.id !== pane.id))
                publishActivePane()
              },
              async (cols, rows) => {
                try {
                  const result = await window.desktop.resumeTerminalConversation(
                    id,
                    attempt,
                    cols,
                    rows
                  )
                  if ('terminal' in result) return result.terminal
                  if (result.discardedTerminalId) discardTerminalOutput(result.discardedTerminalId)
                  if (!cancelled) setRestore(paneKey, saved, result.failure)
                } catch (error) {
                  if (!cancelled)
                    setRestore(paneKey, saved, {
                      reason: 'launch failed',
                      detail: mainErrorMessage(error),
                      settings: false
                    })
                }
                return null
              }
            )
            shells.set(pane.id, {
              dispose: () => {
                cancelled = true
                void window.desktop.cancelTerminalResume(attempt).catch(() => undefined)
                shell.dispose()
              }
            })
          }
        : null
      setRecovery((current) => [
        ...current.filter((item) => item.pane.id !== pane.id),
        { pane, retry, close: () => panes.closePane(pane.id) }
      ])
      retry?.()
    }
    let nextResume: SavedConversation | undefined
    const createPane = (pane: ManagedPane, leaf?: Extract<PaneLayout, { kind: 'pane' }>) => {
      const conversation = leaf?.conversation ?? nextResume?.id
      nextResume = undefined
      pane.container.dataset.layoutId = leaf?.id ?? crypto.randomUUID()
      bindClipboardKeys(pane.terminal)
      if (conversation) {
        pane.container.dataset.conversation = conversation
        mountRecovery(pane, conversation)
      } else {
        const agent = nextLaunch
        nextLaunch = undefined
        shells.set(
          pane.id,
          startPaneShell(pane, tab.cwd, () => panes.closePane(pane.id), agent, publishActivePane)
        )
      }
      publishActivePane()
    }
    let nextLaunch = tab.saved ? undefined : tab.agent
    const panes = new PaneManager(
      element,
      {
        terminalOptions: currentTerminalOptions,
        gpuAcceleration: () => useSettingsStore.getState().values['terminal.gpuAcceleration'],
        onActivePaneChange: publishActivePane,
        onPaneCreated: createPane,
        onPaneClosed: (paneId) => {
          shells.get(paneId)?.dispose()
          shells.delete(paneId)
          const recoveryId = recoveryIds.get(paneId)
          if (recoveryId) clearRestore(recoveryId)
          recoveryIds.delete(paneId)
          setRecovery((current) => current.filter((item) => item.pane.id !== paneId))
          if (panes.getPanes().length === 0) closeTab(tab.id)
          else publishActivePane()
        },
        closePaneTitle: `Close Pane (${terminalShortcutLabel(useKeymapStore.getState().shell, 'close-pane')})`,
        onLinkClick: (event, url) => {
          // Ctrl/Cmd+click, as in VS Code, so selecting text across a link doesn't open it.
          if (!event.ctrlKey && !event.metaKey) return
          void window.desktop.openWebLink(url).catch((error: unknown) =>
            notify({
              severity: 'error',
              title: 'Could not open terminal link',
              body: mainErrorMessage(error)
            })
          )
        }
      },
      checkpoint
    )
    manager.current = panes
    if (tab.saved) panes.restore(tab.saved.layout, tab.saved.activePane, createPane)
    else panes.createInitialPane()
    const findTerminal = (id: string) =>
      panes
        .getPanes()
        .find(
          ({ container: { dataset } }) =>
            dataset.terminalId === id ||
            dataset.layoutId === id ||
            (dataset.conversation === id && !dataset.terminalId)
        )
    terminalTabControllers.set(tab.id, {
      hasTerminal: (id) => findTerminal(id) !== undefined,
      run: (command) => {
        const activePane = panes.getActivePane()
        if (command === 'focus-next-pane') panes.focusSibling(1)
        else if (command === 'focus-previous-pane') panes.focusSibling(-1)
        else if (!activePane) return
        else if (command === 'split-right') panes.splitPane(activePane.id, 'vertical')
        else if (command === 'split-down') panes.splitPane(activePane.id, 'horizontal')
        else panes.closePane(activePane.id)
      },
      closeTerminal: (id) => {
        const pane = findTerminal(id)
        if (!pane) return false
        panes.closePane(pane.id)
        return true
      },
      selectTerminal: (id) => {
        const pane = findTerminal(id)
        if (!pane) return false
        panes.setActivePane(pane.id, isShown.current)
        return true
      },
      resumeSplit: (conversation) => {
        const pane = panes.getActivePane()
        if (!pane) return false
        nextResume = conversation
        try {
          return panes.splitPane(pane.id, 'vertical') !== null
        } finally {
          nextResume = undefined
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
      focus: () => {
        const pane = panes.getActivePane()
        const action = pane?.container.querySelector<HTMLButtonElement>(
          '[data-resume-action]:not(:disabled)'
        )
        if (action) action.focus()
        else pane?.terminal.focus()
      },
      isShown: () => isShown.current
    })
    return () => {
      terminalTabControllers.delete(tab.id)
      for (const shell of shells.values()) shell.dispose()
      shells.clear()
      for (const id of recoveryIds.values()) clearRestore(id)
      panes.destroy()
      manager.current = null
    }
  }, [tab])

  useEffect(() => {
    manager.current?.setTerminalOptions({ fontFamily, fontSize, lineHeight })
  }, [fontFamily, fontSize, lineHeight])

  useEffect(() => {
    manager.current?.setTerminalOptions({ theme: terminalTheme(colorTheme) })
  }, [colorTheme])

  useEffect(() => {
    manager.current?.setGpuAcceleration(gpuAcceleration)
  }, [gpuAcceleration])

  useEffect(() => {
    isShown.current = shown
  }, [shown])

  // Showing the terminals again (a tab chosen, back from Settings or another view) gives them the keys.
  useEffect(() => {
    if (shown) terminalTabControllers.get(tab.id)?.focus()
  }, [shown, tab.id])

  return (
    <>
      <TerminalContextMenu
        activeTerminal={() => manager.current?.getActivePane()?.terminal ?? null}
        launchSplit={(provider) => terminalTabControllers.get(tab.id)?.launchSplit(provider)}
        canLaunch={() => {
          const pane = manager.current?.getActivePane()
          return Boolean(pane?.container.dataset.terminalId && !pane.container.dataset.exited)
        }}
        runCommand={(command) => terminalTabControllers.get(tab.id)?.run(command)}
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
      {recovery.map(({ pane, retry, close }) =>
        createPortal(
          <RestoreFailurePane
            pane={pane.container.dataset.layoutId ?? ''}
            retry={retry}
            close={close}
          />,
          pane.container,
          String(pane.id)
        )
      )}
    </>
  )
}
