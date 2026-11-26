import { FileCode, FileDiff, GitCompareArrows, History, type LucideIcon } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { PanelHeaderButton } from '@/components/shell/PanelHeaderButton'
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
import { cn } from '@/lib/class-names'
import { appCommandForKey, appShortcutLabel } from '@/lib/keymap-match'
import { PaneManager } from '@/lib/pane-manager/pane-manager'
import { type HunkTab, useHunkTabStore } from '@/state/hunk-tab-store'
import { useKeymapStore } from '@/state/keymap-store'
import { useSourceControlStore } from '@/state/source-control-store'
import type {
  ChangedFile,
  HunkView,
  SourceControlGroup
} from '../../../../shared/source-control-api'
import { openInEditor } from './changed-file-actions'
import { CHANGE_KINDS } from './ChangesTree'

const TAB_ICONS: Record<HunkView['kind'], LucideIcon> = {
  review: GitCompareArrows,
  log: History,
  diff: FileDiff
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
                ...tab.view,
                root: tab.root,
                ...size
              })
              if (launch.status === 'missing') {
                tabs.hunkMissing(tab.id)
                return null
              }
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

  const { view } = tab
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
      onKeyDownCapture={(event) => {
        // Jump to Source wins over hunk's own keys, as in a JetBrains diff.
        if (view.kind !== 'diff') return
        if (appCommandForKey(event, useKeymapStore.getState().shell) !== 'jump-to-source') return
        event.preventDefault()
        event.stopPropagation()
        if (!isDeleted(tab.root, view.path)) openInEditor(tab.tip)
      }}
    >
      {view.kind === 'diff' ? (
        <FileDiffBar root={tab.root} path={view.path} file={tab.tip} />
      ) : null}
      <div ref={root} className="min-h-0 flex-1 rounded-b-island" />
    </div>
  )
}

/** The changed file's current status entry; none once it is committed or rolled back. */
function changedFile(
  groups: readonly SourceControlGroup[] | null,
  root: string,
  path: string
): ChangedFile | undefined {
  const group = groups?.find((each) => each.root === root)
  return group?.status === 'git' ? group.files.find((file) => file.path === path) : undefined
}

const isDeleted = (root: string, path: string): boolean =>
  changedFile(useSourceControlStore.getState().groups, root, path)?.kind === 'deleted'

/** A file diff's bar, as over a JetBrains diff: which file, and the way to its source. */
function FileDiffBar({
  root,
  path,
  file
}: {
  root: string
  path: string
  /** Its full path. */
  file: string
}): React.JSX.Element {
  const kind = useSourceControlStore((state) => changedFile(state.groups, root, path)?.kind)
  const keymap = useKeymapStore((state) => state.shell)
  const shortcut = appShortcutLabel(keymap, 'jump-to-source')
  const change = kind ? CHANGE_KINDS[kind] : null
  return (
    <div
      role="toolbar"
      aria-label="Diff"
      className="flex h-control shrink-0 items-center gap-2 pr-1 pl-3 shadow-[inset_0_-1px_0_var(--separator)]"
    >
      {/* rtl so a long path loses its start, not the file name. */}
      <span dir="rtl" className="type-hint min-w-0 flex-1 truncate text-left">
        <bdi>{path}</bdi>
      </span>
      {change ? (
        <span className={cn('shrink-0 font-mono', change.text)}>
          <span aria-hidden>{change.letter}</span>
          <span className="sr-only">{change.label}</span>
        </span>
      ) : null}
      <PanelHeaderButton
        label="Open in Editor"
        disabled={kind === 'deleted'}
        onClick={() => openInEditor(file)}
        tip={
          kind === 'deleted' ? (
            'Deleted: there is no file to open'
          ) : (
            <span className="flex gap-2">
              Open in Editor
              {shortcut ? <span className="text-tooltip-muted-foreground">{shortcut}</span> : null}
            </span>
          )
        }
      >
        <FileCode className="size-4" strokeWidth={1.75} aria-hidden />
      </PanelHeaderButton>
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
  const closeTab = useHunkTabStore((state) => state.closeTab)

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
              const Icon = TAB_ICONS[tab.view.kind]
              return (
                <StripTab
                  key={tab.id}
                  title={tab.title}
                  label={tab.title}
                  active={tab.id === activeTabId}
                  icon={<Icon className="size-4 shrink-0" aria-hidden />}
                  tip={tab.tip}
                  onActivate={() => activateTab(tab.id)}
                  onClose={() => closeTab(tab.id)}
                />
              )
            })}
        </ScrollingTabList>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
        {tabs.map((tab) => (
          <HunkTabBody
            key={tab.id}
            tab={tab}
            active={tab.id === activeTabId}
            pending={pending.has(tab.id)}
            shown={tab.id === activeTabId && placement === 'shown'}
          />
        ))}
      </div>
    </div>
  )
}
