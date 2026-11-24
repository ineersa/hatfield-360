import { AgentAttention } from './AgentAttention'
import { ProjectPicker } from './ProjectPicker'
import {
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
  Lock,
  Trash2
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
import { Fragment, useState } from 'react'
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
  project,
  sessions,
  hasSessions
}: {
  worktree: Worktree
  project: string
  sessions: AgentSession[]
  hasSessions: boolean
}): React.JSX.Element {
  const label = worktreeLabel(worktree)
  const [collapsed, setCollapsed] = useState(false)
  const pathTip = usePointerTooltip()
  const pruneMissing = useWorktreeStore((state) => state.pruneMissing)
  return (
    <li aria-label={`${label} worktree${worktree.prunable ? ' (missing)' : ''}`}>
      <ContextMenu>
        <Tooltip delayDuration={PATH_TOOLTIP_DELAY_MS} onOpenChange={pathTip.onOpenChange}>
          <ContextMenuTrigger asChild>
            <TooltipTrigger asChild onPointerMove={pathTip.track}>
              <div
                tabIndex={0}
                className="type-tree-row flex h-tree-row cursor-default items-center gap-2 rounded-component pr-2.5 pl-1 text-muted-foreground outline-none select-none hover:bg-row-hover focus-visible:bg-selection-inactive data-[state=open]:bg-selection-inactive"
              >
                {hasSessions ? (
                  <button
                    type="button"
                    aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${label} checkout`}
                    aria-expanded={!collapsed}
                    onClick={() => setCollapsed(!collapsed)}
                    className="flex size-4 shrink-0 items-center justify-center rounded-button focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ChevronRight
                      className={cn('size-3.5', !collapsed && 'rotate-90')}
                      aria-hidden
                    />
                  </button>
                ) : (
                  <span className="size-4 shrink-0" aria-hidden />
                )}
                <GitBranch className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span
                  className={cn(
                    'truncate',
                    worktree.prunable && 'text-muted-foreground line-through'
                  )}
                >
                  {label}
                </span>
                {!worktree.project && (
                  <span className="type-hint min-w-0 shrink truncate">{worktree.name}</span>
                )}
                {worktree.locked ? (
                  <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-label="locked" />
                ) : null}
                {worktree.prunable ? (
                  <span className="type-hint ml-auto shrink-0 text-error">missing</span>
                ) : null}
              </div>
            </TooltipTrigger>
          </ContextMenuTrigger>
          <TooltipContent {...pathTip.placement}>{worktree.path}</TooltipContent>
        </Tooltip>
        <OpenTerminalMenuContent cwd={worktree.path} project={project} disabled={worktree.prunable}>
          {worktree.prunable && !worktree.locked ? (
            <ContextMenuItem onSelect={() => void pruneMissing(project, worktree.path)}>
              <Trash2 aria-hidden /> Prune all missing worktree entries in repository
            </ContextMenuItem>
          ) : null}
        </OpenTerminalMenuContent>
      </ContextMenu>
      {!collapsed && sessions.length > 0 && (
        <ul aria-label={`${label} checkout sessions`}>
          <AgentSessionRows sessions={sessions} />
        </ul>
      )}
    </li>
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
  visible
}: {
  folder: string
  sessions: AgentSession[]
  visible: AgentSession[]
}): React.JSX.Element | null {
  const project = useWorktreeStore((state) => state.projects[folder])
  const collapsed = useWorktreeStore((state) => state.collapsed[folder] === true)
  if (collapsed) return null
  if (project?.status === 'git' && hasChildRows(project)) {
    const primary = project.worktrees.find((tree) => tree.project)
    const linked = project.worktrees.filter((tree) => !tree.project)
    const belongsTo = (session: AgentSession, tree: Worktree) =>
      tree.project
        ? !linked.some((item) => item.path === session.worktree)
        : session.worktree === tree.path
    return (
      <li>
        <ul aria-label="Project checkouts" className="flex flex-col gap-1 pl-tree-indent">
          {(primary ? [primary, ...linked] : linked).map((tree) => (
            <WorktreeRow
              key={tree.path}
              worktree={tree}
              project={folder}
              sessions={visible.filter((session) => belongsTo(session, tree))}
              hasSessions={sessions.some((session) => belongsTo(session, tree))}
            />
          ))}
          {!primary && (
            <AgentSessionRows
              sessions={visible.filter(
                (session) => !linked.some((item) => item.path === session.worktree)
              )}
            />
          )}
        </ul>
      </li>
    )
  }
  return (
    <>
      {project?.status === 'error' && (
        <li role="alert" className="type-hint flex gap-2 py-1 pr-2.5 pl-tree-indent">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-error" aria-hidden />
          <span className="min-w-0 break-words">Git: {project.message}</span>
        </li>
      )}
      <AgentSessionRows sessions={visible} />
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
              {checkout && !hasChildRows(project) ? (
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
  const [filter, setFilter] = useState<SessionFilter | null>(null)
  const scope = folders.some((folder) => folder.path === project) ? project : ''
  const visible = sessions.filter(
    (session) =>
      (!scope || session.project === scope) && (!filter || matchesStatus(session, filter))
  )
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
      <AgentAttention sessions={sessions} folders={folders} />
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
            <ProjectPicker folders={folders} value={scope} onChange={setProject} />
            <div
              role="group"
              aria-label="Filter sessions by status"
              className="flex flex-wrap gap-1 py-2"
            >
              <button
                type="button"
                aria-pressed={filter === null}
                onClick={() => setFilter(null)}
                className={cn(filterClass, filter === null && 'border-ring bg-hover')}
              >
                All
              </button>
              {(['working', 'attention', 'idle', 'stopped'] as const).map((key) => {
                const { icon: Icon, label, color } = statuses[key]
                const pressed = filter === key
                return (
                  <button
                    type="button"
                    key={key}
                    aria-pressed={pressed}
                    onClick={() => setFilter(key)}
                    className={cn(filterClass, color, pressed && 'border-ring bg-hover')}
                  >
                    <Icon aria-hidden className="size-3" />
                    {label}
                  </button>
                )
              })}
            </div>
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
                      folder={folder.path}
                      sessions={sessions.filter((session) => session.project === folder.path)}
                      visible={visible.filter((session) => session.project === folder.path)}
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
                <AgentSessionRows sessions={ungrouped} />
              </ul>
            </div>
          )}
        </div>
      )}
    </>
  )
}
