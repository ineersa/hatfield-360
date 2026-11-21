import { AgentSessionRows, useAgentSessions } from './AgentSessionRows'
import { AGENT_PROVIDERS, type AgentSession } from '../../../../shared/agent-api'
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
import {
  PATH_TOOLTIP_DELAY_MS,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  usePointerTooltip
} from '@/components/ui/tooltip'
import { cn } from '@/lib/class-names'
import { Fragment, type ReactNode, useRef, useState } from 'react'
import { focusActiveTerminal } from '@/components/terminal/use-terminal-commands'
import { useTerminalStore } from '@/state/terminal-store'
import {
  OpenFolderEmptyState,
  WorkspaceProblemBanner
} from '@/components/workspace/WorkspaceNotices'
import { useWorkspaceStore } from '@/state/workspace-store'
import { useWorktreeStore } from '@/state/worktree-store'
import type { WorkspaceFolder } from '../../../../shared/workspace-api'
import type { ProjectWorktrees, Worktree } from '../../../../shared/worktree-api'

/** A tree row's right-click menu: Open Terminal Here first, then the row's own items. */
function RowMenuContent({
  cwd,
  project,
  disabled,
  children
}: {
  cwd: string
  project: string
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
      {(['hatfield', 'claude'] as const).map((provider) => (
        <ContextMenuItem
          key={provider}
          disabled={disabled}
          onSelect={() => {
            openedTerminal.current = true
            openTerminal(cwd, { provider, target: { project, cwd } })
          }}
        >
          Launch {AGENT_PROVIDERS[provider]}
        </ContextMenuItem>
      ))}
      {children}
    </ContextMenuContent>
  )
}

const worktreeLabel = (worktree: Worktree): string =>
  worktree.branch ?? `detached ${worktree.head.slice(0, 7)}`

function WorktreeRow({
  worktree,
  project
}: {
  worktree: Worktree
  project: string
}): React.JSX.Element {
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
      <RowMenuContent cwd={worktree.path} project={project} disabled={worktree.prunable} />
    </ContextMenu>
  )
}

/** Rows a project can fold away: its linked worktrees, or why git can't list them. */
function hasChildRows(project: ProjectWorktrees | undefined): boolean {
  if (project?.status === 'error') return true
  return project?.status === 'git' && project.worktrees.some((worktree) => !worktree.project)
}

function ProjectWorktreeRows({
  folder,
  sessions
}: {
  folder: string
  sessions: AgentSession[]
}): React.JSX.Element | null {
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
  return (
    <>
      <AgentSessionRows
        sessions={sessions.filter(
          (session) =>
            session.cwd === folder ||
            project?.status !== 'git' ||
            !project.worktrees.some((tree) => !tree.project && tree.path === session.cwd)
        )}
      />
      {project?.status === 'git' &&
        project.worktrees
          .filter((worktree) => !worktree.project)
          .map((worktree) => (
            <Fragment key={worktree.path}>
              <WorktreeRow worktree={worktree} project={folder} />
              <AgentSessionRows
                sessions={sessions.filter((session) => session.cwd === worktree.path)}
              />
            </Fragment>
          ))}
    </>
  )
}

function ProjectRow({
  folder,
  hasSessions
}: {
  folder: WorkspaceFolder
  hasSessions: boolean
}): React.JSX.Element {
  const removeFolder = useWorkspaceStore((state) => state.removeFolder)
  const setFolderKind = useWorkspaceStore((state) => state.setFolderKind)
  const pathTip = usePointerTooltip()
  const project = useWorktreeStore((state) => state.projects[folder.path])
  const collapsed = useWorktreeStore((state) => state.collapsed[folder.path] === true)
  const toggleCollapsed = useWorktreeStore((state) => state.toggleCollapsed)
  const checkout =
    project?.status === 'git' ? project.worktrees.find((worktree) => worktree.project) : undefined
  const foldable = !folder.missing && (hasChildRows(project) || hasSessions)
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
      <RowMenuContent cwd={folder.path} project={folder.path} disabled={folder.missing}>
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
  const { sessions, error } = useAgentSessions()
  const [filter, setFilter] = useState('all')
  const visible = sessions.filter(
    (session) =>
      filter === 'all' ||
      (filter === 'attention'
        ? !!session.wait
        : filter === 'working'
          ? session.activity === 'working' && !session.wait
          : filter === 'idle'
            ? session.activity === 'idle' && !session.wait
            : filter === 'unknown'
              ? session.process === 'running' && session.activity === 'unknown' && !session.wait
              : session.process === 'exited')
  )
  const attention = sessions.filter((session) => session.wait)
  const ungrouped = visible.filter(
    (session) => !folders.some((folder) => !folder.missing && folder.path === session.project)
  )
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
      {error ? (
        <p role="alert" className="type-hint px-4 text-error">
          Agent status unavailable: {error}
        </p>
      ) : null}
      {problem ? <WorkspaceProblemBanner problem={problem} /> : null}
      {workspace && folders.length === 0 && sessions.length === 0 && !workspace.problem ? (
        <OpenFolderEmptyState
          message={
            allFolders.length === 0
              ? 'No folders in this workspace yet.'
              : 'No projects in this workspace. Its other folders are in the Files view.'
          }
        />
      ) : (
        <div className="min-h-0 overflow-y-auto">
          {sessions.length > 0 && (
            <div className="px-2 pb-2">
              <select
                aria-label="Filter sessions by status"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                className="type-body h-control w-full rounded-component border border-separator bg-island px-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <option value="all">All sessions</option>
                <option value="attention">Needs input</option>
                <option value="working">Working</option>
                <option value="idle">Idle</option>
                <option value="unknown">Status unavailable</option>
                <option value="exited">Exited</option>
              </select>
              {attention.length > 0 && (
                <details open className="mt-2 rounded-component bg-hover">
                  <summary className="type-section-title cursor-pointer px-2 py-1.5">
                    Needs input · {attention.length}
                  </summary>
                  <ul aria-label="Sessions needing input">
                    <AgentSessionRows sessions={attention} />
                  </ul>
                </details>
              )}
              {visible.length === 0 && (
                <p className="type-hint px-2 pt-2">No sessions match this filter.</p>
              )}
            </div>
          )}
          <ul aria-label="Workspace folders" className="flex min-h-0 flex-col gap-0.5 px-2">
            {folders.map((folder) => (
              <Fragment key={folder.path}>
                <ProjectRow
                  folder={folder}
                  hasSessions={sessions.some((session) => session.project === folder.path)}
                />
                {folder.missing ? null : (
                  <ProjectWorktreeRows
                    folder={folder.path}
                    sessions={visible.filter((session) => session.project === folder.path)}
                  />
                )}
              </Fragment>
            ))}
          </ul>
          {ungrouped.length > 0 && (
            <div className="px-2 py-2">
              <h3 className="type-section-title px-2">Other terminals</h3>
              <ul>
                <AgentSessionRows sessions={ungrouped} />
              </ul>
            </div>
          )}
        </div>
      )}
    </>
  )
}
