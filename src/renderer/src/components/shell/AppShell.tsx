import { useRef } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  SIDE_PANEL_MIN_WIDTH,
  sidePanelMaxWidth,
  useShellLayoutStore
} from '@/state/shell-layout-store'
import { ActivityBar } from './ActivityBar'
import { SHELL_VIEWS } from './shell-views'
import { SIDE_PANEL_HANDLE_WIDTH, SidePanelResizeHandle } from './SidePanelResizeHandle'
import { StatusBar } from './StatusBar'
import { useElementWidth } from './use-element-width'

export function AppShell(): React.JSX.Element {
  const activeView = useShellLayoutStore((state) => state.activeView)
  const panel = useShellLayoutStore((state) => state.panels[state.activeView])
  const setPanelWidth = useShellLayoutStore((state) => state.setPanelWidth)
  const workArea = useRef<HTMLDivElement>(null)
  const maxWidth = sidePanelMaxWidth(useElementWidth(workArea), SIDE_PANEL_HANDLE_WIDTH)
  // The stored width is kept as chosen, so the panel grows back when the window widens again.
  const width = Math.min(panel.width, maxWidth)
  const view = SHELL_VIEWS.find((candidate) => candidate.id === activeView) ?? SHELL_VIEWS[0]
  if (!view) throw new Error('No shell views defined')

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col bg-background text-foreground">
        <div className="flex min-h-0 flex-1 pt-1.5 pr-1.5">
          <ActivityBar />
          <div ref={workArea} className="flex min-w-0 flex-1">
            {panel.collapsed ? null : (
              <>
                <aside
                  aria-label={`${view.label} panel`}
                  style={{ width }}
                  className="flex shrink-0 flex-col overflow-hidden rounded-xl bg-island"
                >
                  <h2 className="flex h-10 shrink-0 items-center px-4 font-semibold">
                    {view.panelTitle}
                  </h2>
                  <p className="px-4 text-muted-foreground">{view.panelPlaceholder}</p>
                </aside>
                <SidePanelResizeHandle
                  label={`Resize ${view.label} panel`}
                  width={width}
                  minWidth={SIDE_PANEL_MIN_WIDTH}
                  maxWidth={maxWidth}
                  onWidthChange={(next) => setPanelWidth(view.id, Math.min(next, maxWidth))}
                />
              </>
            )}
            <main
              aria-label={view.label}
              className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 rounded-xl bg-island p-8 text-center"
            >
              <view.Icon className="size-10 text-muted-foreground" strokeWidth={1.5} aria-hidden />
              <p className="max-w-sm text-muted-foreground">{view.mainPlaceholder}</p>
            </main>
          </div>
        </div>
        <StatusBar />
      </div>
    </TooltipProvider>
  )
}
