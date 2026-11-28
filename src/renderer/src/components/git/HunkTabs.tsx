import {
  GitBranch,
  GitPullRequest,
  Archive,
  GitCompareArrows,
  History,
  type LucideIcon
} from 'lucide-react'
import { useEffect, useRef } from 'react'
import { HunkTabMenuItems } from '@/components/git/HunkTabMenuItems'
import { ScrollingTabList } from '@/components/shell/ScrollingTabList'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { StripTab } from '@/components/shell/StripTab'
import { startPaneProgram } from '@/components/terminal/pane-shell'
import {
  currentGpuAcceleration,
  currentTerminalOptions,
  useTerminalAppearance
} from '@/components/terminal/terminal-appearance'
import { bindClipboardKeys } from '@/components/terminal/terminal-clipboard'
import { openTerminalLink } from '@/components/terminal/terminal-link'
import { cn } from '@/lib/class-names'
import { PaneManager } from '@/lib/pane-manager/pane-manager'
import { type HunkTab, useHunkTabStore } from '@/state/hunk-tab-store'
import type { HunkKind } from '../../../../shared/source-control-api'

const TAB_ICONS: Record<HunkKind, LucideIcon> = {
  review: GitCompareArrows,
  log: History,
  stash: Archive,
  branch: GitBranch,
  'pull-request': GitPullRequest
}

/**
 * One hunk in a single terminal pane, which starts it at the pane's size; mounted while its tab is
 * open, so hunk runs while hidden. Unmounting ends it, so a remount starts a fresh hunk.
 */
function HunkTabBody({
  tab,
  active,
  pending,
  shown
}: {
  tab: HunkTab
  active: boolean
  /** hunk hasn't started: laid out out of sight, at the size it will be shown at. */
  pending: boolean
  /** Active and on screen: no other view or Settings covers it. */
  shown: boolean
}): React.JSX.Element {
  const root = useRef<HTMLDivElement>(null)
  const manager = useRef<PaneManager | null>(null)
  useTerminalAppearance(manager)

  useEffect(() => {
    const element = root.current
    if (!element) return undefined
    const tabs = useHunkTabStore.getState()
    const close = () => tabs.closeTab(tab.id)
    let program: { dispose: () => void } | null = null
    const panes = new PaneManager(
      element,
      {
        terminalOptions: currentTerminalOptions,
        gpuAcceleration: currentGpuAcceleration,
        onPaneCreated: (pane) => {
          bindClipboardKeys(pane.terminal)
          program = startPaneProgram(pane, {
            start: async (size) => {
              const launch = await window.desktop.launchHunk({
                kind: tab.kind,
                root: tab.root,
                ...(tab.target === null ? {} : { target: tab.target }),
                ...size
              })
              if (launch.status === 'missing') {
                tabs.hunkMissing(tab.id)
                return null
              }
              tabs.attachTerminal(tab.id, launch.terminal.id)
              return { session: launch.terminal, size }
            },
            name: 'hunk',
            // q and Ctrl+C exit with 0; anything else is an error whose output stays readable.
            endsOnAnyExitCode: false,
            onEnded: close,
            onStarted: () => tabs.started(tab.id),
            onStartFailed: (error) => tabs.startFailed(tab.id, error)
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
      role="tabpanel"
      aria-label={tab.title}
      data-testid="hunk-tab-panel"
      className={cn(
        'flex min-h-0 flex-1 flex-col',
        pending && 'pointer-events-none invisible absolute inset-0'
      )}
      hidden={!active && !pending}
    >
      {/* The panes' own root: the pane manager positions it, which would undo `absolute` above. */}
      <div ref={root} className="min-h-0 flex-1 rounded-b-island" />
    </div>
  )
}

/**
 * hunk's tabs in the Git view: a tab strip over one terminal each. `offstage` lays them out unseen
 * behind the Git view's own page, so a first hunk starts at its real size before it is shown.
 */
export function HunkTabs({
  placement
}: {
  placement: 'shown' | 'offstage' | 'hidden'
}): React.JSX.Element {
  const tabs = useHunkTabStore((state) => state.tabs)
  const pending = useHunkTabStore((state) => state.pending)
  const activeTabId = useHunkTabStore((state) => state.activeTabId)
  const activateTab = useHunkTabStore((state) => state.activateTab)
  const requestClose = useHunkTabStore((state) => state.requestClose)
  const withNotes = useHunkTabStore((state) => state.withNotes)
  const settleNotes = useHunkTabStore((state) => state.settleNotes)
  const shownIds = tabs.filter((tab) => !pending.has(tab.id)).map((tab) => tab.id)

  return (
    <div
      className={cn(
        'flex min-w-0 flex-1 flex-col overflow-hidden rounded-island',
        placement === 'offstage' && 'pointer-events-none invisible absolute inset-0'
      )}
      hidden={placement === 'hidden'}
    >
      {/* The active tab covers the strip's bottom line, so it reads as one piece with its terminal. */}
      <div className="flex h-tab-bar shrink-0 items-stretch bg-frame shadow-[inset_0_-1px_0_var(--separator)]">
        <ScrollingTabList label="hunk" selected={activeTabId}>
          {tabs
            .filter((tab) => !pending.has(tab.id))
            .map((tab) => {
              const Icon = TAB_ICONS[tab.kind]
              return (
                <StripTab
                  key={tab.id}
                  id={tab.id}
                  menu={{
                    tabs: shownIds,
                    close: (ids) => void requestClose(ids),
                    renderItems: (choose) => <HunkTabMenuItems tab={tab} choose={choose} />
                  }}
                  title={tab.title}
                  label={tab.title}
                  active={tab.id === activeTabId}
                  icon={<Icon className="size-4 shrink-0" aria-hidden />}
                  tip={tab.root}
                  onActivate={() => activateTab(tab.id)}
                  onClose={() => void requestClose([tab.id])}
                />
              )
            })}
        </ScrollingTabList>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
        {tabs.map((tab) => (
          <HunkTabBody
            key={`${tab.id}:${tab.run}`}
            tab={tab}
            active={tab.id === activeTabId}
            pending={pending.has(tab.id)}
            shown={tab.id === activeTabId && placement === 'shown'}
          />
        ))}
      </div>
      <AlertDialog
        open={withNotes !== null}
        onOpenChange={(open) => {
          if (!open) settleNotes(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>
            {withNotes?.count === 1
              ? 'Close and lose 1 note?'
              : `Close and lose ${withNotes?.count ?? 0} notes?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            hunk keeps review notes only while it runs. Have an agent answer them, or copy what you
            need, before closing.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Open</AlertDialogCancel>
            <AlertDialogAction onClick={() => settleNotes(true)}>Close Anyway</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
