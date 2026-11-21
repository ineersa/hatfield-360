import {
  ChevronRight,
  CircleAlert,
  EyeOff,
  FolderInput,
  FolderMinus,
  FolderPlus,
  FolderX,
  GitBranch,
  RefreshCw
} from 'lucide-react'
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useState } from 'react'
import { FileTreeIcon } from '@/components/icons/FileTreeIcon'
import { RootFolderIcon } from '@/components/icons/RootFolderIcon'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/class-names'
import { useFileTreeStore } from '@/state/file-tree-store'
import { useWorkspaceStore } from '@/state/workspace-store'
import { useWorktreeStore } from '@/state/worktree-store'
import type { DirectoryEntry, DirectoryListing } from '../../../../shared/file-tree-api'
import type { WorkspaceFolder } from '../../../../shared/workspace-api'
import type { ProjectWorktrees } from '../../../../shared/worktree-api'

/** A top-level folder of the tree: a workspace folder or a project's linked worktree. */
type TreeRoot = {
  path: string
  name: string
  /** The checked-out branch, for projects and worktrees. */
  branch: string | null
  /** Set for workspace folders; worktrees come and go with git. */
  folder: WorkspaceFolder | null
}

type Row =
  | { type: 'root'; key: string; depth: 0; root: TreeRoot }
  | { type: 'entry'; key: string; depth: number; entry: DirectoryEntry; ignored: boolean }
  | { type: 'error'; key: string; depth: number; message: string }

function treeRoots(
  folders: WorkspaceFolder[],
  projects: Record<string, ProjectWorktrees>
): TreeRoot[] {
  return folders.flatMap((folder): TreeRoot[] => {
    const project = folder.kind === 'project' ? projects[folder.path] : undefined
    const worktrees = project?.status === 'git' ? project.worktrees : []
    const checkout = worktrees.find((worktree) => worktree.project)
    const branchOf = (worktree: (typeof worktrees)[number]): string =>
      worktree.branch ?? `detached ${worktree.head.slice(0, 7)}`
    return [
      {
        path: folder.path,
        name: folder.name,
        branch: checkout ? branchOf(checkout) : null,
        folder
      },
      ...worktrees
        .filter((worktree) => !worktree.project && !worktree.prunable)
        .map((worktree) => ({
          path: worktree.path,
          name: folder.name,
          branch: branchOf(worktree),
          folder: null
        }))
    ]
  })
}

/** The tree as rows: each root, then the entries of every expanded folder under it. */
function treeRows(
  roots: TreeRoot[],
  expanded: Record<string, boolean>,
  listings: Record<string, DirectoryListing>,
  hideIgnored: boolean
): Row[] {
  const rows: Row[] = []
  const addChildren = (path: string, depth: number, parentIgnored: boolean): void => {
    if (!expanded[path]) return
    const listing = listings[path]
    if (listing?.status === 'error') {
      rows.push({ type: 'error', key: `${path}\0error`, depth, message: listing.message })
      return
    }
    for (const entry of listing?.entries ?? []) {
      const ignored = parentIgnored || entry.ignored
      if (ignored && hideIgnored) continue
      rows.push({ type: 'entry', key: entry.path, depth, entry, ignored })
      if (entry.kind === 'directory') addChildren(entry.path, depth + 1, ignored)
    }
  }
  for (const root of roots) {
    rows.push({ type: 'root', key: root.path, depth: 0, root })
    if (!root.folder?.missing) addChildren(root.path, 1, false)
  }
  return rows
}

/** Arrow keys move between rows and fold folders, as in an IDE's project tree. */
function moveFocus(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="treeitem"]')]
  const index = items.findIndex((item) => item === document.activeElement)
  const next = items[event.key === 'ArrowDown' ? index + 1 : index - 1]
  if (!next) return
  event.preventDefault()
  next.focus()
}

function TreeRow({
  label,
  depth,
  expanded,
  dimmed,
  selected,
  tabbable,
  onSelect,
  onToggle,
  icon,
  hint,
  menu,
  children
}: {
  label: string
  depth: number
  /** Undefined for files. */
  expanded?: boolean
  dimmed: boolean
  selected: boolean
  /** The row Tab lands on: the selected one, or the first. */
  tabbable: boolean
  onSelect: () => void
  onToggle?: () => void
  icon: ReactNode
  hint?: ReactNode
  menu?: ReactNode
  children: ReactNode
}): React.JSX.Element {
  const row = (
    <div
      role="treeitem"
      tabIndex={tabbable ? 0 : -1}
      aria-label={label}
      aria-level={depth + 1}
      aria-expanded={expanded}
      aria-selected={selected}
      data-ignored={dimmed || undefined}
      className={cn(
        'type-tree-row flex h-tree-row shrink-0 cursor-default items-center gap-1 rounded-component pr-2.5 outline-none select-none hover:bg-row-hover focus-visible:bg-selection-inactive data-[state=open]:bg-selection-inactive',
        selected && 'bg-selection-inactive',
        dimmed && 'text-muted-foreground'
      )}
      style={{ paddingLeft: `calc(${depth} * var(--file-tree-indent) + var(--spacing))` }}
      onClick={() => {
        onSelect()
        onToggle?.()
      }}
      onFocus={onSelect}
      onKeyDown={(event) => {
        if (!onToggle) return
        if (
          event.key === 'Enter' ||
          (event.key === 'ArrowRight' && !expanded) ||
          (event.key === 'ArrowLeft' && expanded)
        ) {
          event.preventDefault()
          onToggle()
        }
      }}
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
      <span className="ml-1 truncate">{children}</span>
      {hint}
    </div>
  )
  if (!menu) return row
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent>{menu}</ContextMenuContent>
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

function RootRow({
  root,
  selected,
  tabbable,
  onSelect
}: {
  root: TreeRoot
  selected: boolean
  tabbable: boolean
  onSelect: () => void
}): React.JSX.Element {
  const expanded = useFileTreeStore((state) => state.expanded[root.path] === true)
  const toggle = useFileTreeStore((state) => state.toggle)
  const setFolderKind = useWorkspaceStore((state) => state.setFolderKind)
  const removeFolder = useWorkspaceStore((state) => state.removeFolder)
  const { folder } = root
  const missing = folder?.missing === true
  const label =
    folder === null
      ? [root.name, root.branch, 'worktree'].filter(Boolean).join(' ')
      : missing
        ? `${root.name} (missing)`
        : root.name
  return (
    <TreeRow
      label={label}
      depth={0}
      {...(missing ? {} : { expanded, onToggle: () => toggle(root.path) })}
      dimmed={false}
      selected={selected}
      tabbable={tabbable}
      onSelect={onSelect}
      icon={
        missing ? (
          <FolderX className="size-4.5 shrink-0 text-error" aria-hidden />
        ) : folder?.kind === 'folder' ? (
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
      menu={
        <>
          {missing ? null : <ReloadItem path={root.path} />}
          {folder?.kind === 'folder' ? (
            <ContextMenuItem onSelect={() => void setFolderKind(folder.path, 'project')}>
              <FolderInput aria-hidden />
              Show in Projects
            </ContextMenuItem>
          ) : null}
          {folder?.kind === 'project' ? (
            <ContextMenuItem onSelect={() => void setFolderKind(folder.path, 'folder')}>
              <FolderMinus aria-hidden />
              Hide from Projects
            </ContextMenuItem>
          ) : null}
          {folder ? (
            <ContextMenuItem onSelect={() => void removeFolder(folder.path)}>
              <FolderX aria-hidden />
              Remove from Workspace
            </ContextMenuItem>
          ) : null}
        </>
      }
    >
      <span className="type-project-row">{root.name}</span>
    </TreeRow>
  )
}

function EntryRow({
  entry,
  depth,
  ignored,
  selected,
  tabbable,
  onSelect
}: {
  entry: DirectoryEntry
  depth: number
  ignored: boolean
  selected: boolean
  tabbable: boolean
  onSelect: () => void
}): React.JSX.Element {
  const expanded = useFileTreeStore((state) => state.expanded[entry.path] === true)
  const toggle = useFileTreeStore((state) => state.toggle)
  const directory = entry.kind === 'directory'
  return (
    <TreeRow
      label={entry.name}
      depth={depth}
      {...(directory ? { expanded, onToggle: () => toggle(entry.path) } : {})}
      dimmed={ignored}
      selected={selected}
      tabbable={tabbable}
      onSelect={onSelect}
      icon={
        <FileTreeIcon
          kind={directory ? (expanded ? 'folder-open' : 'folder') : 'file'}
          className={cn('size-4 shrink-0', ignored && 'opacity-50')}
        />
      }
      {...(directory ? { menu: <ReloadItem path={entry.path} /> } : {})}
    >
      {entry.name}
    </TreeRow>
  )
}

/** Files side panel: every workspace folder and project worktree as a live, lazily listed tree. */
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
  const [selected, setSelected] = useState<string | null>(null)

  const folders = workspace?.folders
  const roots = useMemo(() => treeRoots(folders ?? [], projects), [folders, projects])
  const rootKey = roots
    .filter((root) => !root.folder?.missing)
    .map((root) => root.path)
    .join('\0')
  useEffect(() => connect(), [connect])
  useEffect(() => {
    setRoots(rootKey === '' ? [] : rootKey.split('\0'))
  }, [rootKey, setRoots])
  // Closing the panel stops every watch; reopening lists its open folders fresh.
  useEffect(() => () => setRoots([]), [setRoots])

  const rows = treeRows(roots, expanded, listings, hideIgnored)
  const focusable = rows.some((row) => row.key === selected) ? selected : (rows[0]?.key ?? null)

  return (
    <>
      <div className="flex h-panel-header shrink-0 items-center gap-1 pt-1 pr-2 pl-4">
        <h2 className="type-panel-title flex-1 truncate">Files</h2>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Hide Ignored Files"
              aria-pressed={hideIgnored}
              onClick={toggleHideIgnored}
              className={cn(
                'flex size-icon-button items-center justify-center rounded-button text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                hideIgnored && 'bg-selection-inactive text-foreground'
              )}
            >
              <EyeOff className="size-4.5" strokeWidth={1.75} aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Hide Ignored Files</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Add Folder to Workspace"
              onClick={() => void addFolder()}
              className="flex size-icon-button items-center justify-center rounded-button text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <FolderPlus className="size-4.5" strokeWidth={1.75} aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Add Folder to Workspace</TooltipContent>
        </Tooltip>
      </div>
      {workspace && roots.length === 0 ? (
        <p className="type-description px-4 pt-1">No folders in this workspace yet.</p>
      ) : (
        <div
          role="tree"
          aria-label="Files"
          className="flex min-h-0 flex-col gap-px overflow-y-auto px-2 pb-2"
          onKeyDown={moveFocus}
        >
          {rows.map((row) =>
            row.type === 'root' ? (
              <RootRow
                key={row.key}
                root={row.root}
                selected={row.key === selected}
                tabbable={row.key === focusable}
                onSelect={() => setSelected(row.key)}
              />
            ) : row.type === 'entry' ? (
              <EntryRow
                key={row.key}
                entry={row.entry}
                depth={row.depth}
                ignored={row.ignored}
                selected={row.key === selected}
                tabbable={row.key === focusable}
                onSelect={() => setSelected(row.key)}
              />
            ) : (
              <div
                key={row.key}
                role="alert"
                className="type-hint flex shrink-0 items-center gap-2 py-1 pr-2.5"
                style={{
                  paddingLeft: `calc(${row.depth} * var(--file-tree-indent) + var(--spacing))`
                }}
              >
                <CircleAlert className="size-3.5 shrink-0 text-error" aria-hidden />
                <span className="min-w-0 break-words">{row.message}</span>
              </div>
            )
          )}
        </div>
      )}
    </>
  )
}
