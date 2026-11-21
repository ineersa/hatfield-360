import {
  ChevronRight,
  ChevronsDownUp,
  CircleAlert,
  Copy,
  CopySlash,
  Eye,
  EyeOff,
  FolderInput,
  FolderMinus,
  FolderOpen,
  FolderPlus,
  FolderX,
  GitBranch,
  RefreshCw
} from 'lucide-react'
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { FileTreeIcon } from '@/components/icons/FileTreeIcon'
import { RootFolderIcon } from '@/components/icons/RootFolderIcon'
import { OpenTerminalMenuContent } from '@/components/terminal/OpenTerminalMenuContent'
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import {
  PATH_TOOLTIP_DELAY_MS,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  usePointerTooltip
} from '@/components/ui/tooltip'
import {
  OpenFolderEmptyState,
  WorkspaceProblemBanner
} from '@/components/workspace/WorkspaceNotices'
import { cn } from '@/lib/class-names'
import { copyPathFormForKey, copyPathShortcutLabel } from '@/lib/copy-path-keys'
import { rendererPlatform } from '@/lib/terminal-shortcut-label'
import { type FileTreeRoot, useFileTreeStore } from '@/state/file-tree-store'
import { useWorkspaceStore } from '@/state/workspace-store'
import { useWorktreeStore } from '@/state/worktree-store'
import {
  folderOf,
  nameOf,
  pathOf,
  type Row,
  type TreeRoot,
  type TreeWorktree,
  treeRoots,
  treeRows
} from './file-tree-rows'
import type { DirectoryEntry } from '../../../../shared/file-tree-api'

/** A slow folder shows "Loading…" after this; a fast one never flashes it. */
const LOADING_DELAY_MS = 150
/** Typed letters within this gap add up to one name prefix to jump to. */
const TYPE_AHEAD_GAP_MS = 700

const REVEAL_LABEL = /Mac/.test(navigator.userAgent)
  ? 'Reveal in Finder'
  : /Windows/.test(navigator.userAgent)
    ? 'Show in Explorer'
    : 'Show in File Manager'

const indent = (depth: number, extra = 1): string =>
  `calc(${depth} * var(--file-tree-indent) + var(--spacing) * ${extra})`

const isTruncated = (element: HTMLElement | null): boolean =>
  element !== null && element.scrollWidth > element.clientWidth

type RowState = { selected: boolean; tabbable: boolean; onSelect: () => void }

function TreeRow({
  row,
  label,
  description,
  expanded,
  dimmed = false,
  selected,
  tabbable,
  onSelect,
  onToggle,
  icon,
  hint,
  tip,
  menu,
  children
}: RowState & {
  row: Row
  label: string
  description?: string
  /** Undefined for rows that don't fold. */
  expanded?: boolean
  dimmed?: boolean
  onToggle?: () => void
  icon: ReactNode
  hint?: ReactNode
  /** Shown under the pointer: always (a root's path), or only when the name is cut off. */
  tip: { text: string; always: boolean }
  menu?: ReactNode
  children: ReactNode
}): React.JSX.Element {
  const labelRef = useRef<HTMLSpanElement>(null)
  const pointerTip = usePointerTooltip()
  const [tipOpen, setTipOpen] = useState(false)
  const item = (
    <div
      role="treeitem"
      data-tree-key={row.key}
      tabIndex={tabbable ? 0 : -1}
      aria-label={label}
      aria-description={description}
      aria-level={row.depth + 1}
      aria-setsize={row.setSize}
      aria-posinset={row.position}
      aria-expanded={expanded}
      aria-selected={selected}
      data-ignored={dimmed || undefined}
      className={cn(
        'type-tree-row flex h-tree-row shrink-0 cursor-default items-center gap-1 rounded-component pr-2.5 outline-none select-none data-[state=open]:ring-1 data-[state=open]:ring-ring data-[state=open]:ring-inset',
        dimmed && 'text-muted-foreground',
        // As in JetBrains trees: the selection takes the accent while the tree has focus.
        selected
          ? 'bg-selection-inactive group-focus-within/tree:bg-selection group-focus-within/tree:text-selection-foreground'
          : 'hover:bg-row-hover focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset'
      )}
      style={{ paddingLeft: indent(row.depth) }}
      onClick={() => {
        onSelect()
        onToggle?.()
      }}
      onFocus={onSelect}
    >
      {expanded === undefined ? (
        <span className="size-4 shrink-0" aria-hidden />
      ) : (
        <ChevronRight
          className={cn('size-4 shrink-0 text-muted-foreground', expanded && 'rotate-90')}
          aria-hidden
        />
      )}
      {icon}
      <span ref={labelRef} className="ml-1 truncate">
        {children}
      </span>
      {hint}
    </div>
  )
  const withTip = (
    <Tooltip
      delayDuration={PATH_TOOLTIP_DELAY_MS}
      open={tipOpen}
      onOpenChange={(open) => {
        pointerTip.onOpenChange(open)
        setTipOpen(open && (tip.always || isTruncated(labelRef.current)))
      }}
    >
      {menu ? (
        <ContextMenuTrigger asChild>
          <TooltipTrigger
            asChild
            onPointerMove={pointerTip.track}
            // Arrowing through the tree would pop a tooltip at every row; the name is read out anyway.
            onFocus={(event) => event.preventDefault()}
          >
            {item}
          </TooltipTrigger>
        </ContextMenuTrigger>
      ) : (
        <TooltipTrigger
          asChild
          onPointerMove={pointerTip.track}
          onFocus={(event) => event.preventDefault()}
        >
          {item}
        </TooltipTrigger>
      )}
      <TooltipContent {...pointerTip.placement}>{tip.text}</TooltipContent>
    </Tooltip>
  )
  if (!menu) return withTip
  return (
    <ContextMenu>
      {withTip}
      {menu}
    </ContextMenu>
  )
}

function ReloadItem({ path }: { path: string }): React.JSX.Element {
  const reload = useFileTreeStore((state) => state.reload)
  return (
    <ContextMenuItem onSelect={() => reload(path)}>
      <RefreshCw aria-hidden />
      Reload from Disk
    </ContextMenuItem>
  )
}

/** Copy Path, Copy Relative Path (below a root only) and reveal in the system file manager. */
function PathItems({ path, relative }: { path: string; relative: boolean }): React.JSX.Element {
  const copyPath = useFileTreeStore((state) => state.copyPath)
  const reveal = useFileTreeStore((state) => state.reveal)
  return (
    <>
      <ContextMenuItem onSelect={() => copyPath(path, 'absolute')}>
        <Copy aria-hidden />
        Copy Path
        <ContextMenuShortcut>
          {copyPathShortcutLabel('absolute', rendererPlatform)}
        </ContextMenuShortcut>
      </ContextMenuItem>
      {relative ? (
        <ContextMenuItem onSelect={() => copyPath(path, 'relative')}>
          <CopySlash aria-hidden />
          Copy Relative Path
          <ContextMenuShortcut>
            {copyPathShortcutLabel('relative', rendererPlatform)}
          </ContextMenuShortcut>
        </ContextMenuItem>
      ) : null}
      <ContextMenuItem onSelect={() => reveal(path)}>
        <FolderOpen aria-hidden />
        {REVEAL_LABEL}
      </ContextMenuItem>
    </>
  )
}

function RootRow({
  row,
  root,
  ...state
}: RowState & { row: Row; root: TreeRoot }): React.JSX.Element {
  const expanded = useFileTreeStore((store) => store.expanded[root.path] === true)
  const toggle = useFileTreeStore((store) => store.toggle)
  const setFolderKind = useWorkspaceStore((store) => store.setFolderKind)
  const removeFolder = useWorkspaceStore((store) => store.removeFolder)
  const { folder } = root
  const missing = folder.missing
  return (
    <TreeRow
      row={row}
      label={
        missing ? `${root.name} (missing)` : [root.name, root.branch].filter(Boolean).join(' ')
      }
      {...(missing ? {} : { expanded, onToggle: () => toggle(root.path) })}
      {...state}
      icon={
        missing ? (
          <FolderX className="size-4.5 shrink-0 text-error" aria-hidden />
        ) : folder.kind === 'folder' ? (
          <FileTreeIcon kind={expanded ? 'folder-open' : 'folder'} className="size-4.5 shrink-0" />
        ) : (
          <RootFolderIcon className="size-4.5 shrink-0" />
        )
      }
      hint={
        missing ? (
          <span className="type-hint ml-auto shrink-0 text-error">missing</span>
        ) : root.branch ? (
          <span className="type-hint flex min-w-0 shrink items-center gap-1">
            <GitBranch className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{root.branch}</span>
          </span>
        ) : null
      }
      tip={{ text: folder.path, always: true }}
      menu={
        <OpenTerminalMenuContent cwd={root.path} disabled={missing}>
          {missing ? null : (
            <>
              <PathItems path={root.path} relative={false} />
              <ContextMenuSeparator />
              <ReloadItem path={root.path} />
            </>
          )}
          <ContextMenuSeparator />
          {folder.kind === 'folder' ? (
            <ContextMenuItem onSelect={() => void setFolderKind(folder.path, 'project')}>
              <FolderInput aria-hidden />
              Show in Projects
            </ContextMenuItem>
          ) : (
            <ContextMenuItem onSelect={() => void setFolderKind(folder.path, 'folder')}>
              <FolderMinus aria-hidden />
              Hide from Projects
            </ContextMenuItem>
          )}
          <ContextMenuItem onSelect={() => void removeFolder(folder.path)}>
            <FolderX aria-hidden />
            Remove from Workspace
          </ContextMenuItem>
        </OpenTerminalMenuContent>
      }
    >
      <span className="type-project-row">{root.name}</span>
    </TreeRow>
  )
}

/** A project's linked worktree, under the project as in the Projects view: its branch first. */
function WorktreeRow({
  row,
  worktree,
  ...state
}: RowState & { row: Row; worktree: TreeWorktree }): React.JSX.Element {
  const expanded = useFileTreeStore((store) => store.expanded[worktree.path] === true)
  const toggle = useFileTreeStore((store) => store.toggle)
  return (
    <TreeRow
      row={row}
      label={`${worktree.branch} worktree ${worktree.name}`}
      expanded={expanded}
      onToggle={() => toggle(worktree.path)}
      {...state}
      icon={<GitBranch className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
      hint={<span className="type-hint min-w-0 flex-1 truncate">{worktree.name}</span>}
      tip={{ text: worktree.path, always: true }}
      menu={
        <OpenTerminalMenuContent cwd={worktree.path} disabled={false}>
          <PathItems path={worktree.path} relative={false} />
          <ContextMenuSeparator />
          <ReloadItem path={worktree.path} />
        </OpenTerminalMenuContent>
      }
    >
      {worktree.branch}
    </TreeRow>
  )
}

function EntryRow({
  row,
  entry,
  ignored,
  folder,
  ...state
}: RowState & {
  row: Row
  entry: DirectoryEntry
  ignored: boolean
  folder: string
}): React.JSX.Element {
  const expanded = useFileTreeStore((store) => store.expanded[entry.path] === true)
  const toggle = useFileTreeStore((store) => store.toggle)
  const directory = entry.kind === 'directory'
  return (
    <TreeRow
      row={row}
      label={entry.name}
      {...(ignored ? { description: 'Ignored by git' } : {})}
      {...(directory ? { expanded, onToggle: () => toggle(entry.path) } : {})}
      dimmed={ignored}
      {...state}
      icon={
        <FileTreeIcon
          kind={directory ? (expanded ? 'folder-open' : 'folder') : 'file'}
          className={cn('size-4 shrink-0', ignored && 'opacity-50')}
        />
      }
      tip={{ text: entry.name, always: false }}
      menu={
        <OpenTerminalMenuContent cwd={directory ? entry.path : folder} disabled={false}>
          <PathItems path={entry.path} relative />
          {directory ? (
            <>
              <ContextMenuSeparator />
              <ReloadItem path={entry.path} />
            </>
          ) : null}
        </OpenTerminalMenuContent>
      }
    >
      {entry.name}
    </TreeRow>
  )
}

function ErrorRow({
  row,
  folder,
  message,
  ...state
}: RowState & { row: Row; folder: string; message: string }): React.JSX.Element {
  const reload = useFileTreeStore((store) => store.reload)
  return (
    <TreeRow
      row={row}
      label={`Couldn't list this folder: ${message}`}
      description="Press Enter to try again"
      {...state}
      icon={<CircleAlert className="size-4 shrink-0 text-error" aria-hidden />}
      hint={
        <button
          type="button"
          tabIndex={-1}
          className="type-hint ml-auto shrink-0 rounded-button px-1 text-link hover:bg-hover"
          onClick={(event) => {
            event.stopPropagation()
            reload(folder)
          }}
        >
          Retry
        </button>
      }
      tip={{ text: message, always: false }}
    >
      {message}
    </TreeRow>
  )
}

/** "Loading…" for a folder still being listed (after a moment), "Empty" for one with nothing shown. */
function StatusRow({
  row,
  loading,
  onlyIgnored
}: {
  row: Row
  loading: boolean
  onlyIgnored: boolean
}): React.JSX.Element {
  const [shown, setShown] = useState(!loading)
  useEffect(() => {
    if (shown) return undefined
    const timer = setTimeout(() => setShown(true), LOADING_DELAY_MS)
    return () => clearTimeout(timer)
  }, [shown])
  const text = loading ? 'Loading…' : onlyIgnored ? 'Only ignored files' : 'Empty'
  return (
    <div
      role="treeitem"
      aria-disabled
      aria-label={text}
      aria-level={row.depth + 1}
      aria-setsize={row.setSize}
      aria-posinset={row.position}
      aria-selected={false}
      className="type-hint flex h-tree-row shrink-0 items-center select-none"
      style={{ paddingLeft: indent(row.depth, 6) }}
    >
      {shown ? text : null}
    </div>
  )
}

function HeaderButton({
  label,
  pressed,
  onClick,
  tip,
  children
}: {
  label: string
  pressed?: boolean
  onClick: () => void
  tip?: ReactNode
  children: ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={pressed}
          onClick={onClick}
          className={cn(
            'flex size-icon-button items-center justify-center rounded-button text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
            pressed && 'bg-selection-inactive text-foreground'
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{tip ?? label}</TooltipContent>
    </Tooltip>
  )
}

/** Files side panel: every workspace folder, with its project's worktrees, as a live, lazily listed tree. */
export function FilesPanel(): React.JSX.Element {
  const workspace = useWorkspaceStore((state) => state.workspace)
  const addFolder = useWorkspaceStore((state) => state.addFolder)
  const projects = useWorktreeStore((state) => state.projects)
  const expanded = useFileTreeStore((state) => state.expanded)
  const listings = useFileTreeStore((state) => state.listings)
  const hideIgnored = useFileTreeStore((state) => state.hideIgnored)
  const toggleHideIgnored = useFileTreeStore((state) => state.toggleHideIgnored)
  const setRoots = useFileTreeStore((state) => state.setRoots)
  const connect = useFileTreeStore((state) => state.connect)
  const toggle = useFileTreeStore((state) => state.toggle)
  const expand = useFileTreeStore((state) => state.expand)
  const collapseAll = useFileTreeStore((state) => state.collapseAll)
  const reload = useFileTreeStore((state) => state.reload)
  const copyPath = useFileTreeStore((state) => state.copyPath)
  const [selected, setSelected] = useState<string | null>(null)
  const treeRef = useRef<HTMLDivElement>(null)
  const typeAhead = useRef({ text: '', at: 0 })

  const folders = workspace?.folders
  const roots = useMemo(() => treeRoots(folders ?? [], projects), [folders, projects])
  const watchedRoots = useMemo(
    (): FileTreeRoot[] =>
      roots
        .filter((root) => !root.folder.missing)
        .map((root) => ({ path: root.path, worktrees: root.worktrees.map((tree) => tree.path) })),
    [roots]
  )
  useEffect(() => connect(), [connect])
  useEffect(() => setRoots(watchedRoots), [watchedRoots, setRoots])
  // Closing the panel stops every watch; reopening lists its open folders fresh.
  useEffect(() => () => setRoots([]), [setRoots])

  const { rows, hiddenIgnored } = treeRows(roots, expanded, listings, hideIgnored)
  const navigable = rows.filter((row) => row.type !== 'loading' && row.type !== 'empty')
  const focusable = navigable.some((row) => row.key === selected)
    ? selected
    : (navigable[0]?.key ?? null)
  const problem = workspace?.problem ?? null

  const focusRow = (key: string | undefined): void => {
    if (key === undefined) return
    for (const item of treeRef.current?.querySelectorAll<HTMLElement>('[data-tree-key]') ?? []) {
      if (item.dataset.treeKey === key) {
        item.focus()
        return
      }
    }
  }

  /** The WAI-ARIA tree keys, plus IDE ones: `*` expands siblings, letters jump by name. */
  const onTreeKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const target =
      event.target instanceof HTMLElement ? event.target.closest('[data-tree-key]') : null
    const key = target instanceof HTMLElement ? target.dataset.treeKey : undefined
    const index = navigable.findIndex((row) => row.key === key)
    const row = navigable[index]
    if (!row) return
    const form = copyPathFormForKey(event, rendererPlatform)
    if (form) {
      event.preventDefault()
      const path = pathOf(row)
      if (path !== null && (form === 'absolute' || row.type === 'entry')) copyPath(path, form)
      return
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const folder = folderOf(row)
    const handled = ((): boolean => {
      switch (event.key) {
        case 'ArrowDown':
          focusRow(navigable[index + 1]?.key)
          return true
        case 'ArrowUp':
          focusRow(navigable[index - 1]?.key)
          return true
        case 'Home':
          focusRow(navigable[0]?.key)
          return true
        case 'End':
          focusRow(navigable.at(-1)?.key)
          return true
        case 'ArrowRight': {
          if (folder === null) return true
          if (!expanded[folder]) toggle(folder)
          else if (navigable[index + 1]?.parent === row.key) focusRow(navigable[index + 1]?.key)
          return true
        }
        case 'ArrowLeft':
          if (folder !== null && expanded[folder]) toggle(folder)
          else focusRow(row.parent ?? undefined)
          return true
        case 'Enter':
          if (row.type === 'error') reload(row.folder)
          else if (folder !== null) toggle(folder)
          return true
        case '*':
          expand(
            navigable
              .filter((sibling) => sibling.parent === row.parent)
              .flatMap((sibling) => folderOf(sibling) ?? [])
          )
          return true
        default:
          break
      }
      if (event.key.length !== 1 || (event.key === ' ' && typeAhead.current.text === '')) {
        return false
      }
      const typed = typeAhead.current
      typed.text =
        event.timeStamp - typed.at > TYPE_AHEAD_GAP_MS
          ? event.key.toLowerCase()
          : typed.text + event.key.toLowerCase()
      typed.at = event.timeStamp
      // A new search starts after the current row; a longer prefix may still match it.
      const start = typed.text.length === 1 ? index + 1 : index
      for (let step = 0; step < navigable.length; step++) {
        const candidate = navigable[(start + step) % navigable.length]
        if (candidate && nameOf(candidate)?.toLowerCase().startsWith(typed.text)) {
          focusRow(candidate.key)
          break
        }
      }
      return true
    })()
    if (handled) event.preventDefault()
  }

  const stateOf = (row: Row): RowState => ({
    selected: row.key === selected,
    tabbable: row.key === focusable,
    onSelect: () => setSelected(row.key)
  })

  const renderRow = (row: Row): React.JSX.Element => {
    switch (row.type) {
      case 'root':
        return (
          // A root stays on top while its folders scroll under it.
          <div key={row.key} className="sticky top-0 z-10 -mx-2 bg-island px-2 not-first:mt-1.5">
            <RootRow row={row} root={row.root} {...stateOf(row)} />
          </div>
        )
      case 'worktree':
        return <WorktreeRow key={row.key} row={row} worktree={row.worktree} {...stateOf(row)} />
      case 'entry':
        return (
          <EntryRow
            key={row.key}
            row={row}
            entry={row.entry}
            ignored={row.ignored}
            folder={row.folder}
            {...stateOf(row)}
          />
        )
      case 'error':
        return (
          <ErrorRow
            key={row.key}
            row={row}
            folder={row.folder}
            message={row.message}
            {...stateOf(row)}
          />
        )
      default:
        return (
          <StatusRow
            key={row.key}
            row={row}
            loading={row.type === 'loading'}
            onlyIgnored={row.onlyIgnored}
          />
        )
    }
  }

  return (
    <>
      <div className="flex h-panel-header shrink-0 items-center gap-1 pt-1 pr-2 pl-4">
        <h2 className="type-panel-title flex-1 truncate">Files</h2>
        <HeaderButton label="Collapse All" onClick={collapseAll}>
          <ChevronsDownUp className="size-4.5" strokeWidth={1.75} aria-hidden />
        </HeaderButton>
        <HeaderButton
          label="Hide Ignored Files"
          pressed={hideIgnored}
          onClick={toggleHideIgnored}
          tip={
            <span className="flex flex-col">
              <span>Hide Ignored Files</span>
              <span className="text-tooltip-muted-foreground">
                {hideIgnored
                  ? `${hiddenIgnored} hidden in open folders`
                  : 'Files git ignores are dimmed'}
              </span>
            </span>
          }
        >
          {hideIgnored ? (
            <EyeOff className="size-4.5" strokeWidth={1.75} aria-hidden />
          ) : (
            <Eye className="size-4.5" strokeWidth={1.75} aria-hidden />
          )}
        </HeaderButton>
        <HeaderButton label="Add Folder to Workspace" onClick={() => void addFolder()}>
          <FolderPlus className="size-4.5" strokeWidth={1.75} aria-hidden />
        </HeaderButton>
      </div>
      {problem ? <WorkspaceProblemBanner problem={problem} /> : null}
      {workspace && roots.length === 0 && !problem ? (
        <OpenFolderEmptyState message="No folders in this workspace yet." />
      ) : (
        <div
          ref={treeRef}
          role="tree"
          aria-label="Files"
          className="group/tree flex min-h-0 scroll-pt-tree-row flex-col gap-px overflow-y-auto px-2 pb-2"
          onKeyDown={onTreeKeyDown}
        >
          {rows.map(renderRow)}
        </div>
      )}
    </>
  )
}
