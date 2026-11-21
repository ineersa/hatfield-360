import {
  ChevronRight,
  CircleAlert,
  FolderMinus,
  FolderPlus,
  FolderX,
  GitBranch,
  Lock,
  SquareTerminal
} from 'lucide-react'
import { RootFolderIcon } from '@/components/icons/RootFolderIcon'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { Tooltip, TooltipContent, TooltipTrigger, usePointerTooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/class-names'
import { Fragment, type ReactNode, useRef } from 'react'
import { focusActiveTerminal } from '@/components/terminal/use-terminal-commands'
import { useTerminalStore } from '@/state/terminal-store'
import { useWorkspaceStore } from '@/state/workspace-store'
import { useWorktreeStore } from '@/state/worktree-store'
import type { WorkspaceFolder } from '../../../../shared/workspace-api'
import type { ProjectWorktrees, Worktree } from '../../../../shared/worktree-api'

/** A tree row's right-click menu: Open Terminal Here first, then the row's own items. */
function RowMenuContent({
  cwd,
  disabled,
  children
}: {
  cwd: string
  disabled: boolean
  children?: ReactNode
}): React.JSX.Element {
  const openTerminal = useTerminalStore((state) => state.openTerminal)
  const openedTerminal = useRef(false)
  return (
    <ContextMenuContent
      onCloseAutoFocus={(event) => {
        if (!openedTerminal.current) return
        // The new terminal gets the keys, not the row the menu would return them to.
        event.preventDefault()
        openedTerminal.current = false
        setTimeout(focusActiveTerminal, 0)
      }}
    >
      <ContextMenuItem
        disabled={disabled}
        onSelect={() => {
          openedTerminal.current = true
          openTerminal(cwd)
        }}
      >
        <SquareTerminal aria-hidden />
        Open Terminal Here
      </ContextMenuItem>
      {children}
    </ContextMenuContent>
  )
}

/** Long enough that moving through the tree doesn't flash a path at every row; the path shows under the pointer. */
const PATH_TOOLTIP_DELAY_MS = 700

const worktreeLabel = (worktree: Worktree): string =>
  worktree.branch ?? `detached ${worktree.head.slice(0, 7)}`

function WorktreeRow({ worktree }: { worktree: Worktree }): React.JSX.Element {
  const label = worktreeLabel(worktree)
  const pathTip = usePointerTooltip()
  return (
    <ContextMenu>
      <Tooltip delayDuration={PATH_TOOLTIP_DELAY_MS} onOpenChange={pathTip.onOpenChange}>
        <ContextMenuTrigger asChild>
          <TooltipTrigger asChild onPointerMove={pathTip.track}>
            <li
              tabIndex={0}
              aria-label={`${label} worktree${worktree.prunable ? ' (missing)' : ''}`}
              className="type-tree-row flex h-tree-row cursor-default items-center gap-2 rounded-component pr-2.5 pl-tree-indent outline-none select-none hover:bg-row-hover focus-visible:bg-selection-inactive data-[state=open]:bg-selection-inactive"
            >
              <GitBranch className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span
                className={cn(
                  'truncate',
                  worktree.prunable && 'text-muted-foreground line-through'
                )}
              >
                {label}
              </span>
              <span className="type-hint min-w-0 shrink truncate">{worktree.name}</span>
              {worktree.locked ? (
                <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-label="locked" />
              ) : null}
              {worktree.prunable ? (
                <span className="type-hint ml-auto shrink-0 text-error">missing</span>
              ) : null}
            </li>
          </TooltipTrigger>
        </ContextMenuTrigger>
        <TooltipContent {...pathTip.placement}>{worktree.path}</TooltipContent>
      </Tooltip>
      <RowMenuContent cwd={worktree.path} disabled={worktree.prunable} />
    </ContextMenu>
  )
}

/** The project's worktrees under its row; nothing for a folder outside git. */
/** Rows a project can fold away: its linked worktrees, or why git can't list them. */
function hasChildRows(project: ProjectWorktrees | undefined): boolean {
  if (project?.status === 'error') return true
  return project?.status === 'git' && project.worktrees.some((worktree) => !worktree.project)
}

function ProjectWorktreeRows({ folder }: { folder: string }): React.JSX.Element | null {
  const project = useWorktreeStore((state) => state.projects[folder])
  const collapsed = useWorktreeStore((state) => state.collapsed[folder] === true)
  if (collapsed) return null
  if (project?.status === 'error') {
    return (
      <li role="alert" className="type-hint flex gap-2 py-1 pr-2.5 pl-tree-indent">
        <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-error" aria-hidden />
        <span className="min-w-0 break-words">Git: {project.message}</span>
      </li>
    )
  }
  if (project?.status !== 'git') return null
  return (
    <>
      {project.worktrees
        .filter((worktree) => !worktree.project)
        .map((worktree) => (
          <WorktreeRow key={worktree.path} worktree={worktree} />
        ))}
    </>
  )
}

function ProjectRow({ folder }: { folder: WorkspaceFolder }): React.JSX.Element {
  const removeFolder = useWorkspaceStore((state) => state.removeFolder)
  const setFolderKind = useWorkspaceStore((state) => state.setFolderKind)
  const pathTip = usePointerTooltip()
  const project = useWorktreeStore((state) => state.projects[folder.path])
  const collapsed = useWorktreeStore((state) => state.collapsed[folder.path] === true)
  const toggleCollapsed = useWorktreeStore((state) => state.toggleCollapsed)
  const checkout =
    project?.status === 'git' ? project.worktrees.find((worktree) => worktree.project) : undefined
  const foldable = !folder.missing && hasChildRows(project)
  return (
    <ContextMenu>
      <Tooltip delayDuration={PATH_TOOLTIP_DELAY_MS} onOpenChange={pathTip.onOpenChange}>
        <ContextMenuTrigger asChild>
          <TooltipTrigger asChild onPointerMove={pathTip.track}>
            <li
              tabIndex={0}
              aria-label={folder.missing ? `${folder.name} (missing)` : folder.name}
              className="flex h-project-row cursor-default items-center gap-1.5 rounded-component pr-2.5 pl-1 outline-none select-none hover:bg-row-hover focus-visible:bg-selection-inactive data-[state=open]:bg-selection-inactive"
              onClick={() => {
                if (foldable) toggleCollapsed(folder.path)
              }}
              onKeyDown={(event) => {
                if (!foldable) return
                if (event.key === 'ArrowLeft' && !collapsed) toggleCollapsed(folder.path)
                else if (event.key === 'ArrowRight' && collapsed) toggleCollapsed(folder.path)
              }}
            >
              {foldable ? (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${folder.name}`}
                  aria-expanded={!collapsed}
                  className="flex size-5 shrink-0 items-center justify-center rounded-button text-muted-foreground"
                >
                  <ChevronRight className={cn('size-4', !collapsed && 'rotate-90')} aria-hidden />
                </button>
              ) : (
                <span className="size-5 shrink-0" aria-hidden />
              )}
              {folder.missing ? (
                <FolderX className="size-4.5 shrink-0 text-error" aria-hidden />
              ) : (
                <RootFolderIcon className="size-4.5 shrink-0" />
              )}
              <span
                className={cn(
                  'type-project-row ml-1 truncate',
                  folder.missing && 'text-muted-foreground line-through'
                )}
              >
                {folder.name}
              </span>
              {checkout ? (
                <span className="type-hint flex min-w-0 shrink items-center gap-1">
                  <GitBranch className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{worktreeLabel(checkout)}</span>
                </span>
              ) : null}
              {folder.missing ? (
                <span className="type-hint ml-auto shrink-0 text-error">missing</span>
              ) : null}
            </li>
          </TooltipTrigger>
        </ContextMenuTrigger>
        <TooltipContent {...pathTip.placement}>{folder.path}</TooltipContent>
      </Tooltip>
      <RowMenuContent cwd={folder.path} disabled={folder.missing}>
        <ContextMenuItem onSelect={() => void setFolderKind(folder.path, 'folder')}>
          <FolderMinus aria-hidden />
          Hide from Projects
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void removeFolder(folder.path)}>
          <FolderX aria-hidden />
          Remove from Workspace
        </ContextMenuItem>
      </RowMenuContent>
    </ContextMenu>
  )
}

/** Agents side panel: the open workspace's projects; plain folders show only in the Files view. */
export function WorkspacePanel(): React.JSX.Element {
  const workspace = useWorkspaceStore((state) => state.workspace)
  const addFolder = useWorkspaceStore((state) => state.addFolder)

  const allFolders = workspace?.folders ?? []
  const folders = allFolders.filter((folder) => folder.kind === 'project')
  // Action errors and notices show in the shell's workspace message; the panel shows why the workspace is read-only.
  const problem = workspace?.problem ?? null

  return (
    <>
      <div className="flex h-panel-header shrink-0 items-center gap-1 pt-1 pr-2 pl-4">
        <h2 className="type-panel-title flex-1 truncate">Projects</h2>
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
      {problem ? (
        <p
          role="alert"
          className="mx-2 mb-2 flex gap-2 rounded-banner border border-error-border bg-error-background px-2 py-1.5"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-error" aria-hidden />
          {problem}
        </p>
      ) : null}
      {workspace && folders.length === 0 && !workspace.problem ? (
        <div className="flex flex-col items-start gap-3 px-4 pt-1">
          <p className="type-description">
            {allFolders.length === 0
              ? 'No folders in this workspace yet.'
              : 'No projects in this workspace. Its other folders are in the Files view.'}
          </p>
          <button
            type="button"
            onClick={() => void addFolder()}
            className="type-button flex h-control items-center gap-2 rounded-button bg-primary px-3.5 text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <FolderPlus className="size-4" aria-hidden />
            Open Folder
          </button>
        </div>
      ) : (
        <ul
          aria-label="Workspace folders"
          className="flex min-h-0 flex-col gap-0.5 overflow-y-auto px-2"
        >
          {folders.map((folder) => (
            <Fragment key={folder.path}>
              <ProjectRow folder={folder} />
              {folder.missing ? null : <ProjectWorktreeRows folder={folder.path} />}
            </Fragment>
          ))}
        </ul>
      )}
    </>
  )
}
