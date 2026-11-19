import { useEffect, useRef } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { WelcomeScreen } from '@/components/workspace/WelcomeScreen'
import { SIDE_PANEL_MIN_WIDTH, useShellLayoutStore } from '@/state/shell-layout-store'
import { useWorkspaceStore } from '@/state/workspace-store'
import { ActivityBar } from './ActivityBar'
import { SHELL_VIEWS } from './shell-views'
import { SIDE_PANEL_HANDLE_WIDTH, SidePanelResizeHandle } from './SidePanelResizeHandle'
import { StatusBar } from './StatusBar'

/** Sliver of main area that stays visible however wide the side panel gets, as in JetBrains IDEs. */
const MAIN_AREA_MIN_WIDTH = 120

export function AppShell(): React.JSX.Element {
  const activeView = useShellLayoutStore((state) => state.activeView)
  const panel = useShellLayoutStore((state) => state.panels[state.activeView])
  const setPanelWidth = useShellLayoutStore((state) => state.setPanelWidth)
  const aside = useRef<HTMLElement>(null)
  const connectWorkspace = useWorkspaceStore((state) => state.connect)
  const workspaceName = useWorkspaceStore((state) => state.workspace?.name)
  const workspaceEmpty = useWorkspaceStore((state) => state.workspace?.folders.length === 0)

  useEffect(() => connectWorkspace(), [connectWorkspace])
  useEffect(() => {
    document.title = workspaceName ? `${workspaceName} — Hatfield 360` : 'Hatfield 360'
  }, [workspaceName])
  // Measured when the user resizes, so it always matches the current window.
  const maxWidth = (): number => {
    const container = aside.current?.parentElement?.clientWidth ?? 0
    return Math.max(SIDE_PANEL_MIN_WIDTH, container - SIDE_PANEL_HANDLE_WIDTH - MAIN_AREA_MIN_WIDTH)
  }
  const view = SHELL_VIEWS.find((candidate) => candidate.id === activeView) ?? SHELL_VIEWS[0]
  if (!view) throw new Error('No shell views defined')

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col bg-background text-foreground">
        <div className="flex min-h-0 flex-1 pt-1.5 pr-1.5">
          <ActivityBar />
          <div className="flex min-w-0 flex-1">
            {panel.collapsed ? null : (
              <>
                <aside
                  aria-label={`${view.label} panel`}
                  ref={aside}
                  // CSS caps the panel when the window narrows; the chosen width returns when there is room.
                  style={{
                    width: panel.width,
                    minWidth: SIDE_PANEL_MIN_WIDTH,
                    maxWidth: `calc(100% - ${SIDE_PANEL_HANDLE_WIDTH + MAIN_AREA_MIN_WIDTH}px)`
                  }}
                  className="flex shrink-0 flex-col overflow-hidden rounded-xl bg-island"
                >
                  {view.Panel ? (
                    <view.Panel />
                  ) : (
                    <>
                      <h2 className="flex h-10 shrink-0 items-center px-4 font-semibold">
                        {view.panelTitle}
                      </h2>
                      <p className="px-4 text-muted-foreground">{view.panelPlaceholder}</p>
                    </>
                  )}
                </aside>
                <SidePanelResizeHandle
                  label={`Resize ${view.label} panel`}
                  width={panel.width}
                  renderedWidth={() => aside.current?.getBoundingClientRect().width ?? panel.width}
                  minWidth={SIDE_PANEL_MIN_WIDTH}
                  maxWidth={maxWidth}
                  onWidthChange={(next) => setPanelWidth(view.id, Math.min(next, maxWidth()))}
                />
              </>
            )}
            <main aria-label={view.label} className="flex min-w-0 flex-1 rounded-xl bg-island">
              {workspaceEmpty ? (
                <WelcomeScreen />
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
                  <view.Icon
                    className="size-10 text-muted-foreground"
                    strokeWidth={1.5}
                    aria-hidden
                  />
                  <p className="max-w-sm text-muted-foreground">{view.mainPlaceholder}</p>
                </div>
              )}
            </main>
          </div>
        </div>
        <StatusBar />
      </div>
    </TooltipProvider>
  )
}
