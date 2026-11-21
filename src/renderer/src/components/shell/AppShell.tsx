import { useEffect, useRef } from 'react'
import { SettingsPage } from '@/components/settings/SettingsPage'
import { useAppFont } from '@/components/settings/use-app-font'
import { useColorThemes } from '@/components/settings/use-color-themes'
import { NotificationsBar } from '@/components/notifications/NotificationsBar'
import { NotificationsPanel } from '@/components/notifications/NotificationsPanel'
import { Toaster } from '@/components/notifications/Toaster'
import { TerminalTabs } from '@/components/terminal/TerminalTabs'
import { useTerminalCommands } from '@/components/terminal/use-terminal-commands'
import { TooltipProvider } from '@/components/ui/tooltip'
import { WelcomeScreen } from '@/components/workspace/WelcomeScreen'
import { useNotificationStore } from '@/state/notification-store'
import { useSettingsStore } from '@/state/settings-store'
import { SIDE_PANEL_MIN_WIDTH, useShellLayoutStore } from '@/state/shell-layout-store'
import { useTerminalStore } from '@/state/terminal-store'
import { useWorktreeStore } from '@/state/worktree-store'
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

  const connectWorktrees = useWorktreeStore((state) => state.connect)
  const connectSettings = useSettingsStore((state) => state.connect)
  const settingsOpen = useShellLayoutStore((state) => state.settingsOpen)
  const openSettings = useShellLayoutStore((state) => state.openSettings)
  const connectLayout = useShellLayoutStore((state) => state.connect)
  const layoutLoaded = useShellLayoutStore((state) => state.loaded)
  const hasTerminals = useTerminalStore((state) => state.tabs.length > 0)
  const notificationsOpen = useNotificationStore((state) => state.panelOpen)

  useEffect(() => connectWorkspace(), [connectWorkspace])
  useEffect(() => connectWorktrees(), [connectWorktrees])
  useEffect(() => connectSettings(), [connectSettings])
  useEffect(() => connectLayout(), [connectLayout])
  useEffect(() => window.desktop.subscribeShowSettings(openSettings), [openSettings])
  useAppFont()
  useColorThemes()
  useTerminalCommands()
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
  // A blank frame for the moment it takes to read the saved layout, instead of a default one that jumps.
  if (!layoutLoaded) return <div className="h-screen bg-frame" />
  // Terminal tabs stay mounted behind other views and Settings, so their shells keep running.
  const showTerminals = hasTerminals && !settingsOpen && view.id === 'agents'

  return (
    <TooltipProvider>
      <div className="type-body flex h-screen flex-col bg-frame">
        <div className="flex min-h-0 flex-1 pt-island-gap">
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
                  className="flex shrink-0 flex-col overflow-hidden rounded-island bg-island"
                >
                  {view.Panel ? (
                    <view.Panel />
                  ) : (
                    <>
                      <h2 className="type-panel-title flex h-panel-header shrink-0 items-center px-4">
                        {view.panelTitle}
                      </h2>
                      <p className="type-description px-4">{view.panelPlaceholder}</p>
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
            <main
              aria-label={settingsOpen ? 'Settings' : view.label}
              className="flex min-w-0 flex-1 rounded-island bg-island"
            >
              {hasTerminals ? <TerminalTabs hidden={!showTerminals} /> : null}
              {showTerminals ? null : settingsOpen ? (
                <SettingsPage />
              ) : workspaceEmpty ? (
                <WelcomeScreen />
              ) : view.MainEmpty ? (
                <view.MainEmpty />
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
                  <view.Icon
                    className="size-empty-state-icon text-muted-foreground"
                    strokeWidth={1.5}
                    aria-hidden
                  />
                  <p className="type-description max-w-sm">{view.mainPlaceholder}</p>
                </div>
              )}
            </main>
          </div>
          {notificationsOpen ? <NotificationsPanel /> : null}
          <NotificationsBar />
        </div>
        <StatusBar />
        <Toaster />
      </div>
    </TooltipProvider>
  )
}
