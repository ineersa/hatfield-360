import type { ITerminalOptions } from '@xterm/xterm'
import { useEffect, useRef } from 'react'
import { PaneManager } from '@/lib/pane-manager/pane-manager'
import { terminalShortcutLabel } from '@/lib/terminal-shortcut-label'
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
    const panes = new PaneManager(element, {
      terminalOptions: currentTerminalOptions,
      gpuAcceleration: () => useSettingsStore.getState().values['terminal.gpuAcceleration'],
      onPaneCreated: (pane) => {
        bindClipboardKeys(pane.terminal)
        shells.set(
          pane.id,
          startPaneShell(pane, tab.cwd, () => panes.closePane(pane.id))
        )
      },
      onPaneClosed: (paneId) => {
        shells.get(paneId)?.dispose()
        shells.delete(paneId)
        if (panes.getPanes().length === 0) closeTab(tab.id)
      },
      closePaneTitle: `Close Pane (${terminalShortcutLabel('close-pane')})`,
      onLinkClick: (event, url) => {
        // Ctrl/Cmd+click, as in VS Code, so selecting text across a link doesn't open it.
        if (!event.ctrlKey && !event.metaKey) return
        void window.desktop.openTerminalLink(url).catch(() => undefined)
      }
    })
    manager.current = panes
    panes.createInitialPane()
    terminalTabControllers.set(tab.id, {
      run: (command) => {
        const activePane = panes.getActivePane()
        if (command === 'focus-next-pane') panes.focusSibling(1)
        else if (command === 'focus-previous-pane') panes.focusSibling(-1)
        else if (!activePane) return
        else if (command === 'split-right') panes.splitPane(activePane.id, 'vertical')
        else if (command === 'split-down') panes.splitPane(activePane.id, 'horizontal')
        else panes.closePane(activePane.id)
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
  }, [tab.id, tab.cwd])

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
