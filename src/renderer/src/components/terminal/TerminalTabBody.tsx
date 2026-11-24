import { notify } from '@/state/notification-store'
import { mainErrorMessage } from '@/lib/main-error-message'
import type { AgentLaunch } from '../../../../shared/agent-api'
import type { ITerminalOptions } from '@xterm/xterm'
import { useEffect, useRef } from 'react'
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
    const publishActivePane = () =>
      useTerminalStore
        .getState()
        .setActivePane(tab.id, panes.getActivePane()?.container.dataset.terminalId ?? null)
    let nextLaunch = tab.agent
    const panes = new PaneManager(element, {
      terminalOptions: currentTerminalOptions,
      gpuAcceleration: () => useSettingsStore.getState().values['terminal.gpuAcceleration'],
      onActivePaneChange: publishActivePane,
      onPaneCreated: (pane) => {
        const agent = nextLaunch
        nextLaunch = undefined
        bindClipboardKeys(pane.terminal)
        shells.set(
          pane.id,
          startPaneShell(pane, tab.cwd, () => panes.closePane(pane.id), agent, publishActivePane)
        )
      },
      onPaneClosed: (paneId) => {
        shells.get(paneId)?.dispose()
        shells.delete(paneId)
        if (panes.getPanes().length === 0) closeTab(tab.id)
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
    })
    manager.current = panes
    panes.createInitialPane()
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
      isShown: () => isShown.current
    })
    return () => {
      terminalTabControllers.delete(tab.id)
      for (const shell of shells.values()) shell.dispose()
      shells.clear()
      panes.destroy()
      manager.current = null
    }
  }, [tab.id, tab.cwd, tab.agent])

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
  )
}
