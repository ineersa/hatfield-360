import { GitCompareArrows, History } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { ScrollingTabList } from '@/components/shell/ScrollingTabList'
import { StripTab } from '@/components/shell/StripTab'
import { startPaneProgram } from '@/components/terminal/pane-shell'
import {
  currentGpuAcceleration,
  currentTerminalOptions,
  useTerminalAppearance
} from '@/components/terminal/terminal-appearance'
import { bindClipboardKeys } from '@/components/terminal/terminal-clipboard'
import { openTerminalLink } from '@/components/terminal/terminal-link'
import { PaneManager } from '@/lib/pane-manager/pane-manager'
import { type HunkTab, useHunkTabStore } from '@/state/hunk-tab-store'

/** One hunk in a single terminal pane; mounted while its tab is open, so hunk runs while hidden. */
function HunkTabBody({
  tab,
  active,
  shown
}: {
  tab: HunkTab
  active: boolean
  /** Active and on screen: no other view or Settings covers it. */
  shown: boolean
}): React.JSX.Element {
  const root = useRef<HTMLDivElement>(null)
  const manager = useRef<PaneManager | null>(null)
  useTerminalAppearance(manager)

  useEffect(() => {
    const element = root.current
    if (!element) return undefined
    const close = () => useHunkTabStore.getState().closeTab(tab.id)
    let program: { dispose: () => void } | null = null
    const panes = new PaneManager(
      element,
      {
        terminalOptions: currentTerminalOptions,
        gpuAcceleration: currentGpuAcceleration,
        onPaneCreated: (pane) => {
          bindClipboardKeys(pane.terminal)
          program = startPaneProgram(pane, {
            // hunk is already running: the pane takes it over and resizes it to fit.
            start: () => Promise.resolve({ session: tab.terminal, size: tab.size }),
            name: 'hunk',
            endsOnAnyExitCode: false,
            onEnded: close
          })
        },
        onPaneClosed: close,
        onLinkClick: openTerminalLink,
        closePaneTitle: 'Close'
      },
      () => undefined
    )
    manager.current = panes
    panes.createInitialPane()
    return () => {
      program?.dispose()
      // The pane may close before it took hunk over; hunk ends with its tab either way.
      void window.desktop.killTerminal(tab.terminal.id).catch(() => undefined)
      panes.destroy()
      manager.current = null
    }
  }, [tab])

  // Showing the tab (chosen, or back from another view) gives hunk the keys.
  useEffect(() => {
    if (shown) manager.current?.getActivePane()?.terminal.focus()
  }, [shown])

  return (
    <div
      ref={root}
      role="tabpanel"
      aria-label={tab.title}
      data-testid="hunk-tab-panel"
      className="min-h-0 flex-1 rounded-b-island"
      hidden={!active}
    />
  )
}

/** hunk's Review and Log tabs in the Git view: a tab strip over one terminal each. */
export function HunkTabs({ hidden }: { hidden: boolean }): React.JSX.Element {
  const tabs = useHunkTabStore((state) => state.tabs)
  const activeTabId = useHunkTabStore((state) => state.activeTabId)
  const activateTab = useHunkTabStore((state) => state.activateTab)
  const closeTab = useHunkTabStore((state) => state.closeTab)

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-island" hidden={hidden}>
      {/* The active tab covers the strip's bottom line, so it reads as one piece with its terminal. */}
      <div className="flex h-tab-bar shrink-0 items-stretch bg-frame shadow-[inset_0_-1px_0_var(--separator)]">
        <ScrollingTabList label="hunk" selected={activeTabId}>
          {tabs.map((tab) => {
            const Icon = tab.kind === 'review' ? GitCompareArrows : History
            return (
              <StripTab
                key={tab.id}
                title={tab.title}
                label={tab.title}
                active={tab.id === activeTabId}
                icon={<Icon className="size-4 shrink-0" aria-hidden />}
                tip={tab.root}
                onActivate={() => activateTab(tab.id)}
                onClose={() => closeTab(tab.id)}
              />
            )
          })}
        </ScrollingTabList>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {tabs.map((tab) => (
          <HunkTabBody
            key={tab.id}
            tab={tab}
            active={tab.id === activeTabId}
            shown={tab.id === activeTabId && !hidden}
          />
        ))}
      </div>
    </div>
  )
}
