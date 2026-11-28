import { recentCatalogScope, useRecentSessionStore } from '@/state/recent-session-store'
import { RecentSessions } from './RecentSessions'
import {
  RECENT_CONVERSATION_MS,
  type RecentConversation,
  withoutRunning
} from '../../../../shared/recent-conversation'
import { HidePanelButton } from '@/components/shell/HidePanelButton'
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
  FolderGit2,
  FolderMinus,
  FolderPlus,
  FolderX,
  GitBranch,
  Lock,
  Pin,
  Search,
  Trash2
} from 'lucide-react'
import { useTerminalStore } from '@/state/terminal-store'
import { isPinned } from '@/state/pinned-sessions'
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
import { appShortcutLabel } from '@/lib/keymap-match'
import { useKeymapStore } from '@/state/keymap-store'
import { useMemorySearchStore } from '@/state/memory-search-store'
import { focusMemorySearch } from '@/components/memory/MemorySearchDialog'
import { Fragment, useEffect, useId, useRef, useState } from 'react'
import { OpenTerminalMenuContent } from '@/components/terminal/OpenTerminalMenuContent'
import {
  OpenFolderEmptyState,
  WorkspaceProblemBanner
} from '@/components/workspace/WorkspaceNotices'
import { useWorkspaceStore } from '@/state/workspace-store'
import { useWorktreeStore } from '@/state/worktree-store'
import type { WorkspaceFolder } from '../../../../shared/workspace-api'
import type {
  ProjectWorktrees,
  RepositoryWorktrees,
  Worktree
} from '../../../../shared/worktree-api'
import {
  innerRepositoryOf,
  linkedWorktrees,
  projectRepositories
} from '../../../../shared/project-repositories'

const worktreeLabel = (worktree: Worktree): string =>
  worktree.branch ?? `detached ${worktree.head.slice(0, 7)}`

/** The folder's last name, whichever separator its platform uses. */
const lastName = (path: string): string => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path

function WorktreeRow({
  worktree,
  project
}: {
  worktree: Worktree
  project: string
}): React.JSX.Element {
  const label = worktreeLabel(worktree)
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
                <GitBranch className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span
                  className={cn(
                    'truncate',
                    worktree.prunable && 'text-muted-foreground line-through'
                  )}
                >
                  {label}
                </span>
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
              <Trash2 aria-hidden /> Remove missing worktree entry
            </ContextMenuItem>
          ) : null}
        </OpenTerminalMenuContent>
      </ContextMenu>
    </li>
  )
}

/** Rows a project can fold away: its repositories' rows, their linked worktrees, or why git can't list one. */
function hasChildRows(project: ProjectWorktrees | undefined): boolean {
  return (
    projectRepositories(project).some((repository) => repository.status === 'error') ||
    linkedWorktrees(project).length > 0 ||
    (project?.repositories?.length ?? 0) > 0
  )
}

/** The linked worktrees of one repository. */
const ownLinkedWorktrees = (repository: RepositoryWorktrees | undefined): Worktree[] =>
  repository?.status === 'git' ? repository.worktrees.filter((tree) => !tree.project) : []

const checkoutBranch = (repository: RepositoryWorktrees | undefined): string | null =>
  repository?.status === 'git'
    ? (repository.worktrees.find((tree) => tree.project)?.branch ?? null)
    : null

function GitFailure({ name, message }: { name: string; message: string }): React.JSX.Element {
  return (
    <li>
      <p role="alert" className="type-hint flex gap-2 px-1 py-1">
        <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-error" aria-hidden />
        <span className="min-w-0 break-words">
          {name}: {message}
        </span>
      </p>
    </li>
  )
}

function LinkedWorktrees({
  name,
  project,
  worktrees
}: {
  name: string
  project: string
  worktrees: Worktree[]
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  return (
    <li>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => setExpanded(!expanded)}
        className="type-hint flex h-tree-row w-full items-center gap-2 rounded-component px-1 text-muted-foreground hover:bg-row-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <ChevronRight className={cn('size-4 shrink-0', expanded && 'rotate-90')} aria-hidden />
        Worktrees ({worktrees.length})
      </button>
      <ul id={listId} aria-label={`${name} worktrees`} hidden={!expanded}>
        {expanded &&
          worktrees.map((worktree) => (
            <WorktreeRow key={worktree.path} worktree={worktree} project={project} />
          ))}
      </ul>
    </li>
  )
}

/** A repository inside a multi-repo project, with its own sessions, recent sessions and worktrees. */
function RepositoryRow({
  project,
  repository,
  visible,
  recent,
  generation,
  live,
  now
}: {
  project: string
  repository: RepositoryWorktrees
  visible: AgentSession[]
  recent: RecentConversation[]
  generation: number
  live: AgentSession[]
  now: number
}): React.JSX.Element {
  const name = lastName(repository.folder)
  const pathTip = usePointerTooltip()
  const stored = useWorktreeStore((state) => state.repositoryOpen[repository.folder])
  const setOpen = useWorktreeStore((state) => state.setRepositoryOpen)
  const listId = useId()
  const worktrees = ownLinkedWorktrees(repository)
  const branch = checkoutBranch(repository)
  const foldable =
    visible.length > 0 ||
    recent.some((entry) => entry.lastModified > now - RECENT_CONVERSATION_MS) ||
    worktrees.length > 0 ||
    repository.status === 'error'
  const open = foldable && (stored ?? visible.length > 0)
  const toggle = (): void => {
    if (foldable) setOpen(repository.folder, !open)
  }
  return (
    <li>
      <ContextMenu>
        <Tooltip delayDuration={PATH_TOOLTIP_DELAY_MS} onOpenChange={pathTip.onOpenChange}>
          <ContextMenuTrigger asChild>
            <TooltipTrigger asChild onPointerMove={pathTip.track}>
              <div
                role="button"
                tabIndex={0}
                aria-label={`${name} repository`}
                aria-expanded={foldable ? open : undefined}
                aria-controls={foldable ? listId : undefined}
                className="type-tree-row flex h-tree-row cursor-default items-center gap-1.5 rounded-component pr-2.5 pl-1 outline-none select-none hover:bg-row-hover focus-visible:bg-selection-inactive data-[state=open]:bg-selection-inactive"
                onClick={toggle}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    toggle()
                  } else if (event.key === 'ArrowLeft' && open) toggle()
                  else if (event.key === 'ArrowRight' && !open) toggle()
                }}
              >
                {foldable ? (
                  <ChevronRight
                    className={cn('size-4 shrink-0 text-muted-foreground', open && 'rotate-90')}
                    aria-hidden
                  />
                ) : (
                  <span className="size-4 shrink-0" aria-hidden />
                )}
                <FolderGit2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{name}</span>
                {branch ? (
                  <span className="type-hint flex min-w-0 items-center gap-1 text-muted-foreground">
                    <GitBranch className="size-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{branch}</span>
                  </span>
                ) : null}
                {visible.length > 0 && !open ? (
                  <span className="type-hint ml-auto shrink-0 text-muted-foreground tabular-nums">
                    {visible.length}
                  </span>
                ) : null}
              </div>
            </TooltipTrigger>
          </ContextMenuTrigger>
          <TooltipContent {...pathTip.placement}>{repository.folder}</TooltipContent>
        </Tooltip>
        <OpenTerminalMenuContent cwd={repository.folder} project={project} disabled={false} />
      </ContextMenu>
      {open ? (
        <ul id={listId} aria-label={`${name} contents`} className="pl-6">
          {visible.length > 0 && (
            <li className="pb-1">
              <ul aria-label={`${name} sessions`} className="flex flex-col gap-px pl-1.5">
                <AgentSessionRows sessions={visible} />
              </ul>
            </li>
          )}
          <RecentSessions
            project={project}
            name={name}
            projectBranch={branch}
            generation={generation}
            sessions={recent}
            live={live}
            now={now}
          />
          {repository.status === 'error' ? (
            <GitFailure name="Git" message={repository.message} />
          ) : null}
          {worktrees.length > 0 && (
            <LinkedWorktrees name={name} project={project} worktrees={worktrees} />
          )}
        </ul>
      ) : null}
    </li>
  )
}

function ProjectContents({
  folder,
  visible,
  recent,
  generation,
  live,
  now
}: {
  folder: WorkspaceFolder
  visible: AgentSession[]
  recent: RecentConversation[]
  generation: number
  live: AgentSession[]
  now: number
}): React.JSX.Element | null {
  const project = useWorktreeStore((state) => state.projects[folder.path])
  const collapsed = useWorktreeStore((state) => state.collapsed[folder.path] === true)
  if (collapsed) return null
  const own = projectRepositories(project).find((repository) => repository.folder === folder.path)
  const inner = project?.repositories ?? []
  // Sessions in a repository inside a multi-repo project are listed under that repository.
  const placeOf = (cwd: string | null): string | null =>
    cwd === null ? null : innerRepositoryOf(project, cwd)
  const linked = ownLinkedWorktrees(own)
  return (
    <>
      {visible.some((session) => placeOf(session.cwd) === null) && (
        <li className="pb-1">
          <ul aria-label={`${folder.name} sessions`} className="flex flex-col gap-px pl-5.5">
            <AgentSessionRows
              sessions={visible.filter((session) => placeOf(session.cwd) === null)}
            />
          </ul>
        </li>
      )}
      <RecentSessions
        project={folder.path}
        name={folder.name}
        projectBranch={checkoutBranch(own)}
        generation={generation}
        sessions={recent.filter((entry) => placeOf(entry.cwd) === null)}
        live={live}
        now={now}
      />
      {own?.status === 'error' ? <GitFailure name="Git" message={own.message} /> : null}
      {linked.length > 0 && (
        <LinkedWorktrees name={folder.name} project={folder.path} worktrees={linked} />
      )}
      {inner.map((repository) => (
        <RepositoryRow
          key={repository.folder}
          project={folder.path}
          repository={repository}
          visible={visible.filter((session) => placeOf(session.cwd) === repository.folder)}
          recent={recent.filter((entry) => placeOf(entry.cwd) === repository.folder)}
          generation={generation}
          live={live}
          now={now}
        />
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
  const setFolderMultiRepo = useWorkspaceStore((state) => state.setFolderMultiRepo)
  const pathTip = usePointerTooltip()
  const project = useWorktreeStore((state) => state.projects[folder.path])
  const collapsed = useWorktreeStore((state) => state.collapsed[folder.path] === true)
  const toggleCollapsed = useWorktreeStore((state) => state.toggleCollapsed)
  const row = useRef<HTMLLIElement>(null)
  const checkout =
    project?.status === 'git' ? project.worktrees.find((worktree) => worktree.project) : undefined
  const foldable = !folder.missing && (hasChildRows(project) || hasSessions)
  return (
    <ContextMenu>
      <Tooltip delayDuration={PATH_TOOLTIP_DELAY_MS} onOpenChange={pathTip.onOpenChange}>
        <ContextMenuTrigger asChild>
          <TooltipTrigger asChild onPointerMove={pathTip.track}>
            <li
              ref={row}
              tabIndex={0}
              aria-label={folder.missing ? `${folder.name} (missing)` : folder.name}
              className="group flex h-project-row cursor-default items-center gap-1.5 rounded-component pr-2.5 pl-1 outline-none select-none hover:bg-row-hover focus-visible:bg-selection-inactive data-[state=open]:bg-selection-inactive"
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
                  aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${folder.name}`}
                  aria-expanded={!collapsed}
                  className="flex size-5 shrink-0 items-center justify-center rounded-button text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <ChevronRight className={cn('size-4', !collapsed && 'rotate-90')} aria-hidden />
                </button>
              ) : (
                <span className="size-5 shrink-0" aria-hidden />
              )}
              {folder.missing ? (
                <FolderX className="size-4.5 shrink-0 text-error" aria-hidden />
              ) : (
                <RootFolderIcon multiRepo={folder.multiRepo} className="size-4.5 shrink-0" />
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
                <span className="type-hint flex min-w-0 items-center gap-1 text-muted-foreground">
                  <GitBranch className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{worktreeLabel(checkout)}</span>
                </span>
              ) : null}
              {folder.missing ? (
                <span className="type-hint ml-auto shrink-0 text-error">missing</span>
              ) : (
                <button
                  type="button"
                  aria-label={`Search memory in ${folder.name}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    useMemorySearchStore.getState().open(folder.path)
                  }}
                  className="ml-auto flex size-5 shrink-0 items-center justify-center rounded-button text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <Search className="size-4" aria-hidden />
                </button>
              )}
            </li>
          </TooltipTrigger>
        </ContextMenuTrigger>
        <TooltipContent {...pathTip.placement}>{folder.path}</TooltipContent>
      </Tooltip>
      <OpenTerminalMenuContent
        cwd={folder.path}
        project={folder.path}
        disabled={folder.missing}
        onCloseAutoFocus={(event) => {
          // Search Memory's input keeps the keys; the row gets them back when it closes.
          if (useMemorySearchStore.getState().project === null) return
          event.preventDefault()
          focusMemorySearch()
        }}
      >
        <ContextMenuItem
          disabled={folder.missing}
          onSelect={() => useMemorySearchStore.getState().open(folder.path, row.current)}
        >
          <Search aria-hidden />
          Search Memory…
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void setFolderMultiRepo(folder.path, !folder.multiRepo)}>
          <FolderGit2 aria-hidden />
          {folder.multiRepo ? 'Unmark as Multi-Repo Folder' : 'Mark as Multi-Repo Folder'}
        </ContextMenuItem>
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
  const keymap = useKeymapStore((state) => state.shell)

  const allFolders = workspace?.folders ?? []
  const folders = allFolders.filter((folder) => folder.kind === 'project')
  const { sessions, error } = useAgentSessions()
  const [now, setNow] = useState(Date.now)
  const generation = workspace?.terminalGeneration ?? 0
  const catalog = useRecentSessionStore((state) => state.catalog)
  const load = useRecentSessionStore((state) => state.load)
  const projects = useWorktreeStore((state) => state.projects)
  const catalogScope = recentCatalogScope(allFolders, projects)
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    async function refresh(): Promise<void> {
      setNow(Date.now())
      await load(generation, catalogScope)
      if (!stopped && catalogScope !== '[]') timer = setTimeout(() => void refresh(), 60_000)
    }
    void refresh()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [generation, catalogScope, load])
  const currentCatalog =
    catalog?.key === JSON.stringify([generation, catalogScope]) ? catalog : null
  const catalogError = currentCatalog?.errors.join(' ')
  const recent = withoutRunning(
    currentCatalog?.sessions ?? [],
    sessions,
    currentCatalog?.scopeAliases ?? new Map<string, string>()
  ).filter((entry) => entry.lastModified > now - RECENT_CONVERSATION_MS)
  const otherRecent = recent.filter(
    (entry) => !folders.some((folder) => !folder.missing && folder.path === entry.project)
  )
  const [project, setProject] = useState('')
  const [filter, setFilter] = useState<SessionFilter | null>(null)
  const scope = folders.some((folder) => folder.path === project) ? project : ''
  const visible = sessions.filter(
    (session) =>
      (!scope || session.project === scope) && (!filter || matchesStatus(session, filter))
  )
  const pinned = useTerminalStore((state) => state.pinned)
  // Pinned sessions lead in their own section, across projects, and aren't repeated below.
  const pinnedRows = visible.filter((session) => isPinned(session, pinned))
  const listed = visible.filter((session) => !isPinned(session, pinned))
  const ungrouped = listed.filter(
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
              aria-label="Search Memory"
              onClick={() => useMemorySearchStore.getState().open()}
              className="flex size-icon-button items-center justify-center rounded-button text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <Search className="size-4.5" strokeWidth={1.75} aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Search Memory{' '}
            <span className="ml-1 text-tooltip-muted-foreground">
              {appShortcutLabel(keymap, 'search-memory')}
            </span>
          </TooltipContent>
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
        <HidePanelButton view="agents" />
      </div>
      {error ? (
        <p role="alert" className="type-hint px-4 text-error">
          Agent status unavailable: {error}
        </p>
      ) : null}
      {problem ? <WorkspaceProblemBanner problem={problem} /> : null}
      <AgentAttention sessions={sessions} folders={folders} />
      {workspace &&
      folders.length === 0 &&
      sessions.length === 0 &&
      recent.length === 0 &&
      !workspace.problem ? (
        <OpenFolderEmptyState
          message={
            allFolders.length === 0
              ? 'No folders in this workspace yet.'
              : 'No projects in this workspace. Its other folders are in the Files view.'
          }
        />
      ) : (
        <div className="min-h-0 overflow-y-auto">
          <div className="@container px-2 pb-2">
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
                  <Tooltip key={key}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label={label}
                        aria-pressed={pressed}
                        onClick={() => setFilter((current) => (current === key ? null : key))}
                        className={cn(filterClass, color, pressed && 'border-ring bg-hover')}
                      >
                        <Icon aria-hidden className="size-3" />
                        <span className="hidden @min-[360px]:inline">{label}</span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{label}</TooltipContent>
                  </Tooltip>
                )
              })}
            </div>
          </div>
          {pinnedRows.length > 0 ? (
            <section aria-labelledby="pinned-sessions" className="px-2 pb-2">
              <h3
                id="pinned-sessions"
                className="type-section-title flex items-center gap-1.5 px-2 pb-1 text-muted-foreground"
              >
                <Pin className="size-3.5 shrink-0" aria-hidden />
                Pinned
              </h3>
              <ul aria-label="Pinned sessions">
                <AgentSessionRows
                  sessions={pinnedRows}
                  projectName={(session) =>
                    folders.find((folder) => folder.path === session.project)?.name ??
                    'Other terminals'
                  }
                />
              </ul>
            </section>
          ) : null}
          <ul aria-label="Workspace folders" className="flex min-h-0 flex-col gap-0.5 px-2">
            {folders
              .filter((folder) => !scope || folder.path === scope)
              .map((folder) => (
                <Fragment key={folder.path}>
                  <ProjectRow
                    folder={folder}
                    hasSessions={
                      sessions.some((session) => session.project === folder.path) ||
                      recent.some((entry) => entry.project === folder.path)
                    }
                  />
                  {folder.missing ? null : (
                    <ProjectContents
                      key={generation}
                      folder={folder}
                      recent={recent.filter((entry) => entry.project === folder.path)}
                      generation={generation}
                      live={sessions}
                      now={now}
                      visible={listed.filter((session) => session.project === folder.path)}
                    />
                  )}
                </Fragment>
              ))}
          </ul>
          {sessions.length > 0 && visible.length === 0 && (
            <p className="type-hint px-2 pt-2">No sessions match this filter.</p>
          )}
          {(ungrouped.length > 0 || (!scope && otherRecent.length > 0)) && (
            <div className="px-2 py-2">
              <h3 className="type-section-title px-2">Other terminals</h3>
              <ul aria-label="Other terminal sessions">
                <AgentSessionRows sessions={ungrouped} />
                {!scope && (
                  <RecentSessions
                    key={generation}
                    project={null}
                    name="Other terminals"
                    projectBranch={null}
                    generation={generation}
                    sessions={otherRecent}
                    live={sessions}
                    now={now}
                  />
                )}
              </ul>
            </div>
          )}
          {folders.length > 0 &&
          (!currentCatalog || (currentCatalog.loading && currentCatalog.sessions.length === 0)) ? (
            <p role="status" className="type-hint px-4 text-muted-foreground">
              Loading recent sessions…
            </p>
          ) : null}
          {catalogError ? (
            <p role="status" className="type-hint px-4 text-error">
              {catalogError}
            </p>
          ) : null}
        </div>
      )}
    </>
  )
}
