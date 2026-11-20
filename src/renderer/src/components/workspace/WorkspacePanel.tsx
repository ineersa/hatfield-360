import { CircleAlert, FolderPlus, FolderX, GitBranch, Lock, SquareTerminal } from 'lucide-react'
import { RootFolderIcon } from '@/components/icons/RootFolderIcon'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/class-names'
import { Fragment, type ReactNode, useRef } from 'react'
import { focusActiveTerminal } from '@/components/terminal/use-terminal-commands'
import { useTerminalStore } from '@/state/terminal-store'
import { useWorkspaceStore } from '@/state/workspace-store'
import { useWorktreeStore } from '@/state/worktree-store'
import type { WorkspaceFolder } from '../../../../shared/workspace-api'
import type { Worktree } from '../../../../shared/worktree-api'

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

const worktreeLabel = (worktree: Worktree): string =>
  worktree.branch ?? `detached ${worktree.head.slice(0, 7)}`

function WorktreeRow({ worktree }: { worktree: Worktree }): React.JSX.Element {
  const label = worktreeLabel(worktree)
  return (
    <ContextMenu>
      <Tooltip>
        <ContextMenuTrigger asChild>
          <TooltipTrigger asChild>
            <li
              tabIndex={0}
              aria-label={`${label} worktree${worktree.prunable ? ' (missing)' : ''}`}
              className="flex h-8 cursor-default items-center gap-2 rounded-lg pr-2.5 pl-8 outline-none select-none hover:bg-accent focus-visible:bg-accent data-[state=open]:bg-accent"
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
              {worktree.main ? null : (
                <span className="min-w-0 shrink truncate text-ui-sm text-muted-foreground">
                  {worktree.name}
                </span>
              )}
              {worktree.locked ? (
                <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-label="locked" />
              ) : null}
              {worktree.prunable ? (
                <span className="ml-auto shrink-0 text-ui-sm text-destructive">missing</span>
              ) : null}
            </li>
          </TooltipTrigger>
        </ContextMenuTrigger>
        <TooltipContent side="bottom" align="start">
          {worktree.path}
        </TooltipContent>
      </Tooltip>
      <RowMenuContent cwd={worktree.path} disabled={worktree.prunable} />
    </ContextMenu>
  )
}

/** The project's worktrees under its row; nothing for a folder outside git. */
function ProjectWorktreeRows({ folder }: { folder: string }): React.JSX.Element | null {
  const project = useWorktreeStore((state) => state.projects[folder])
  if (project?.status === 'error') {
    return (
      <li role="alert" className="flex gap-2 py-1 pr-2.5 pl-8 text-ui-sm text-muted-foreground">
        <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden />
        <span className="min-w-0 break-words">Git: {project.message}</span>
      </li>
    )
  }
  if (project?.status !== 'git') return null
  return (
    <>
      {project.worktrees.map((worktree) => (
        <WorktreeRow key={worktree.path} worktree={worktree} />
      ))}
    </>
  )
}

function ProjectRow({ folder }: { folder: WorkspaceFolder }): React.JSX.Element {
  const removeFolder = useWorkspaceStore((state) => state.removeFolder)
  return (
    <ContextMenu>
      <Tooltip>
        <ContextMenuTrigger asChild>
          <TooltipTrigger asChild>
            <li
              tabIndex={0}
              aria-label={folder.missing ? `${folder.name} (missing)` : folder.name}
              className="flex h-9 cursor-default items-center gap-2.5 rounded-lg px-2.5 outline-none select-none hover:bg-accent focus-visible:bg-accent data-[state=open]:bg-accent"
            >
              {folder.missing ? (
                <FolderX className="size-[18px] shrink-0 text-destructive" aria-hidden />
              ) : (
                <RootFolderIcon className="size-[18px] shrink-0" />
              )}
              <span
                className={cn(
                  'truncate text-ui-lg font-semibold',
                  folder.missing && 'font-medium text-muted-foreground line-through'
                )}
              >
                {folder.name}
              </span>
              {folder.missing ? (
                <span className="ml-auto shrink-0 text-ui-sm text-destructive">missing</span>
              ) : null}
            </li>
          </TooltipTrigger>
        </ContextMenuTrigger>
        <TooltipContent side="bottom" align="start">
          {folder.path}
        </TooltipContent>
      </Tooltip>
      <RowMenuContent cwd={folder.path} disabled={folder.missing}>
        <ContextMenuItem onSelect={() => void removeFolder(folder.path)}>
          <FolderX aria-hidden />
          Remove from Workspace
        </ContextMenuItem>
      </RowMenuContent>
    </ContextMenu>
  )
}

/** Agents side panel: the open workspace's project folders. */
export function WorkspacePanel(): React.JSX.Element {
  const workspace = useWorkspaceStore((state) => state.workspace)
  const addFolder = useWorkspaceStore((state) => state.addFolder)

  const folders = workspace?.folders ?? []
  // Action errors and notices show in the shell's workspace message; the panel shows why the workspace is read-only.
  const problem = workspace?.problem ?? null

  return (
    <>
      <div className="flex h-11 shrink-0 items-center gap-1 pt-1 pr-2 pl-4">
        <h2 className="flex-1 truncate font-medium text-muted-foreground">Projects</h2>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Add Folder to Workspace"
              onClick={() => void addFolder()}
              className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <FolderPlus className="size-[18px]" strokeWidth={1.75} aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Add Folder to Workspace</TooltipContent>
        </Tooltip>
      </div>
      {problem ? (
        <p role="alert" className="mx-2 mb-2 flex gap-2 rounded-md px-2 py-1.5 text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {problem}
        </p>
      ) : null}
      {workspace && folders.length === 0 && !workspace.problem ? (
        <div className="flex flex-col items-start gap-3 px-4 pt-1">
          <p className="text-muted-foreground">No folders in this workspace yet.</p>
          <button
            type="button"
            onClick={() => void addFolder()}
            className="flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 font-medium text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
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
