import {
  AgentAttention,
  AgentSessionRows,
  matchesStatus,
  statuses,
  type SessionFilter,
  useAgentSessions
} from './AgentSessionRows'
import { type AgentSession } from '../../../../shared/agent-api'
import {
  ChevronRight,
  CircleAlert,
  FolderMinus,
  FolderPlus,
  FolderX,
  GitBranch,
  Lock
} from 'lucide-react'
import { RootFolderIcon } from '@/components/icons/RootFolderIcon'
import { ContextMenu, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import {
  PATH_TOOLTIP_DELAY_MS,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  usePointerTooltip
} from '@/components/ui/tooltip'
import { cn } from '@/lib/class-names'
import { Fragment, useEffect, useState } from 'react'
import { OpenTerminalMenuContent } from '@/components/terminal/OpenTerminalMenuContent'
import {
  OpenFolderEmptyState,
  WorkspaceProblemBanner
} from '@/components/workspace/WorkspaceNotices'
import { useWorkspaceStore } from '@/state/workspace-store'
import { useWorktreeStore } from '@/state/worktree-store'
import type { WorkspaceFolder } from '../../../../shared/workspace-api'
import type { ProjectWorktrees, Worktree } from '../../../../shared/worktree-api'

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
      <OpenTerminalMenuContent cwd={worktree.path} project={project} disabled={worktree.prunable} />
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
  sessions,
  now
}: {
  now: number
  folder: string
  sessions: AgentSession[]
}): React.JSX.Element | null {
  const project = useWorktreeStore((state) => state.projects[folder])
  const collapsed = useWorktreeStore((state) => state.collapsed[folder] === true)
  if (collapsed) return null
  return (
    <>
      {project?.status === 'error' && (
        <li role="alert" className="type-hint flex gap-2 py-1 pr-2.5 pl-tree-indent">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-error" aria-hidden />
          <span className="min-w-0 break-words">Git: {project.message}</span>
        </li>
      )}
      <AgentSessionRows
        now={now}
        sessions={sessions.filter(
          (session) =>
            project?.status !== 'git' ||
            !project.worktrees.some((tree) => !tree.project && tree.path === session.worktree)
        )}
      />
      {project?.status === 'git' &&
        project.worktrees
          .filter((worktree) => !worktree.project)
          .map((worktree) => (
            <Fragment key={worktree.path}>
              <WorktreeRow worktree={worktree} project={folder} />
              <AgentSessionRows
                now={now}
                sessions={sessions.filter((session) => session.worktree === worktree.path)}
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
      <OpenTerminalMenuContent cwd={folder.path} project={folder.path} disabled={folder.missing}>
        <ContextMenuItem onSelect={() => void setFolderKind(folder.path, 'folder')}>
          <FolderMinus aria-hidden />
          Hide from Projects
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void removeFolder(folder.path)}>
          <FolderX aria-hidden />
          Remove from Workspace
        </ContextMenuItem>
      </OpenTerminalMenuContent>
    </ContextMenu>
  )
}

const filterClass =
  'type-hint inline-flex items-center gap-1 rounded-component border border-separator px-1.5 py-0.5 hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

/** Agents side panel: the open workspace's projects; plain folders show only in the Files view. */
export function WorkspacePanel(): React.JSX.Element {
  const workspace = useWorkspaceStore((state) => state.workspace)
  const addFolder = useWorkspaceStore((state) => state.addFolder)

  const allFolders = workspace?.folders ?? []
  const folders = allFolders.filter((folder) => folder.kind === 'project')
  const { sessions, error } = useAgentSessions()
  const [project, setProject] = useState('')
  const [filters, setFilters] = useState<SessionFilter[]>([])
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(timer)
  }, [])
  const scope = folders.some((folder) => folder.path === project) ? project : ''
  const visible = sessions.filter(
    (session) =>
      (!scope || session.project === scope) &&
      (!filters.length || filters.some((filter) => matchesStatus(session, filter)))
  )
  const attention = visible.filter((session) => session.wait)
  const ungrouped = visible.filter(
    (session) => !folders.some((folder) => !folder.missing && folder.path === session.project)
  )
  // Action errors and notices show in the shell's workspace message; the panel shows why the workspace is read-only.
  const problem = workspace?.problem ?? null

  return (
    <>
      <div className="flex h-panel-header shrink-0 items-center gap-1 pt-1 pr-2 pl-4">
        <h2 className="type-panel-title flex-1 truncate">Agents</h2>
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
          <div className="px-2 pb-2">
            <select
              aria-label="Filter by project"
              value={scope}
              onChange={(event) => setProject(event.target.value)}
              className="type-body h-control w-full rounded-component border border-input-border bg-input px-2 text-input-foreground"
            >
              <option value="">All projects</option>
              {folders.map((folder) => (
                <option key={folder.path} value={folder.path}>
                  {folder.name}
                </option>
              ))}
            </select>
            <div
              role="group"
              aria-label="Filter sessions by status"
              className="flex flex-wrap gap-1 py-2"
            >
              <button
                type="button"
                aria-pressed={!filters.length}
                onClick={() => setFilters([])}
                className={cn(filterClass, !filters.length && 'border-ring bg-hover')}
              >
                All
              </button>
              {(['working', 'attention', 'idle', 'stopped'] as const).map((key) => {
                const { icon: Icon, label, color } = statuses[key]
                const pressed = filters.includes(key)
                return (
                  <button
                    type="button"
                    key={key}
                    aria-pressed={pressed}
                    onClick={() =>
                      setFilters((current) =>
                        pressed ? current.filter((value) => value !== key) : [...current, key]
                      )
                    }
                    className={cn(filterClass, color, pressed && 'border-ring bg-hover')}
                  >
                    <Icon aria-hidden className="size-3" />
                    {label}
                  </button>
                )
              })}
            </div>
            <AgentAttention
              sessions={attention}
              projectName={(path) =>
                folders.find((folder) => folder.path === path)?.name ?? 'Other terminals'
              }
            />
          </div>
          <ul aria-label="Workspace folders" className="flex min-h-0 flex-col gap-0.5 px-2">
            {folders
              .filter((folder) => !scope || folder.path === scope)
              .map((folder) => (
                <Fragment key={folder.path}>
                  <ProjectRow
                    folder={folder}
                    hasSessions={sessions.some((session) => session.project === folder.path)}
                  />
                  {folder.missing ? null : (
                    <ProjectWorktreeRows
                      now={now}
                      folder={folder.path}
                      sessions={visible.filter((session) => session.project === folder.path)}
                    />
                  )}
                </Fragment>
              ))}
          </ul>
          {sessions.length > 0 && visible.length === 0 && (
            <p className="type-hint px-2 pt-2">No sessions match this filter.</p>
          )}
          {ungrouped.length > 0 && (
            <div className="px-2 py-2">
              <h3 className="type-section-title px-2">Other terminals</h3>
              <ul>
                <AgentSessionRows now={now} sessions={ungrouped} />
              </ul>
            </div>
          )}
        </div>
      )}
    </>
  )
}
