import {
  GitBranch,
  GitPullRequest,
  Archive,
  GitCompareArrows,
  History,
  RefreshCw,
  Send,
  type LucideIcon
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
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
import { type HunkTab, type TabGitHub, useHunkTabStore } from '@/state/hunk-tab-store'
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
              if (tab.kind === 'pull-request') void tabs.loadGitHub(tab.id)
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
      {tab.kind === 'pull-request' && <PullRequestBar tab={tab} />}
      {/* The panes' own root: the pane manager positions it, which would undo `absolute` above. */}
      <div ref={root} className="min-h-0 flex-1 rounded-b-island" />
    </div>
  )
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

/** What the pull request tab's hunk shows of GitHub. */
function gitHubSummary(comments: TabGitHub['comments'] | undefined): {
  text: string
  failed: boolean
} {
  if (comments === undefined || comments.status === 'loading')
    return { text: 'Loading GitHub comments…', failed: false }
  if (comments.status === 'failed')
    return { text: `Couldn't load GitHub comments: ${comments.message}`, failed: true }
  const shown =
    comments.threads + comments.conversation === 0
      ? 'No open GitHub comments'
      : `GitHub: ${[
          ...(comments.threads > 0 ? [plural(comments.threads, 'thread')] : []),
          ...(comments.conversation > 0 ? [plural(comments.conversation, 'PR comment')] : [])
        ].join(', ')}`
  const hidden =
    comments.notShown > 0 ? ` · ${comments.notShown} not shown (outdated or off the diff)` : ''
  return { text: shown + hidden, failed: false }
}

/** Over a pull request tab's hunk: its GitHub comments, reloading them, and publishing notes. */
function PullRequestBar({ tab }: { tab: HunkTab }): React.JSX.Element {
  const gitHub = useHunkTabStore((state) => state.gitHub[tab.id])
  const [asking, setAsking] = useState<number | null>(null)
  const busy = gitHub === undefined || gitHub.publishing || gitHub.comments.status === 'loading'
  const { text, failed } = gitHubSummary(gitHub?.comments)
  const ask = async () => {
    const tabs = useHunkTabStore.getState()
    const count = await tabs.notesIn(tab.id)
    if (count === 0) void tabs.publishToGitHub(tab.id)
    else setAsking(count)
  }
  return (
    <div className="flex h-status-bar shrink-0 items-center gap-1 bg-island px-2">
      <span
        className={cn(
          'min-w-0 flex-1 truncate type-hint',
          failed ? 'text-error' : 'text-muted-foreground'
        )}
        title={text}
      >
        {gitHub?.publishing ? 'Publishing to GitHub…' : text}
      </span>
      <Button
        variant="ghost"
        size="xs"
        disabled={busy}
        onClick={() => void useHunkTabStore.getState().loadGitHub(tab.id)}
      >
        <RefreshCw aria-hidden />
        Reload
      </Button>
      <Button variant="ghost" size="xs" disabled={busy} onClick={() => void ask()}>
        <Send aria-hidden />
        Publish to GitHub
      </Button>
      <AlertDialog open={asking !== null} onOpenChange={(open) => !open && setAsking(null)}>
        <AlertDialogContent>
          <AlertDialogTitle>
            Publish {plural(asking ?? 0, 'note')} to #{tab.target}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            They're posted on GitHub as you: new notes as one review, replies in their threads. Once
            posted, they show as GitHub comments here.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              primary
              onClick={() => void useHunkTabStore.getState().publishToGitHub(tab.id)}
            >
              Publish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
  const publishAndClose = useHunkTabStore((state) => state.publishAndClose)
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
                  menu={{ tabs: shownIds, close: (ids) => void requestClose(ids) }}
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
            {(withNotes?.publish ?? null) !== null ? 'Publish or lose' : 'Close and lose'}{' '}
            {plural(withNotes?.count ?? 0, 'note')}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {(withNotes?.publish ?? null) !== null
              ? 'Your notes in hunk aren’t on GitHub yet. Publish posts them to the pull request as you; closing ends hunk, and they’re lost.'
              : 'hunk keeps review notes only while it runs. Have an agent answer them, or copy what you need, before closing.'}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Open</AlertDialogCancel>
            <AlertDialogAction onClick={() => settleNotes(true)}>Close Anyway</AlertDialogAction>
            {(withNotes?.publish ?? null) !== null && (
              <AlertDialogAction primary onClick={() => void publishAndClose()}>
                Publish and Close
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
