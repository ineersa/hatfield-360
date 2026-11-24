import { ChevronRight, Columns2, Copy, GitBranch, Play, Search, Trash2 } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { AgentProviderIcon } from '@/components/icons/AgentProviderIcon'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/class-names'
import { notify } from '@/state/notification-store'
import { AGENT_PROVIDERS } from '../../../../shared/agent-api'
import type { WorkspaceFolder } from '../../../../shared/workspace-api'
import { resumeRecent, useTerminalWorkspace } from '@/state/terminal-workspace'
import {
  TERMINAL_WORKSPACE_RECENT_MS,
  type SavedConversation
} from '../../../../shared/terminal-workspace-api'

type RecentSession = SavedConversation & { providerSessionId: string; closedAt: number }
const RECENT_FIRST_PAGE = 5
const RECENT_PAGE = 20
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const RECENT_WINDOW_DAYS = TERMINAL_WORKSPACE_RECENT_MS / DAY

function useRecentClock(): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), MINUTE)
    return () => clearInterval(timer)
  }, [])
  return now
}

function closedAgo(closedAt: number, now: number): string {
  const elapsed = now - closedAt
  if (elapsed < HOUR) return `${Math.max(1, Math.floor(elapsed / MINUTE))}m ago`
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`
  if (elapsed < 2 * DAY) return 'yesterday'
  return `${Math.floor(elapsed / DAY)}d ago`
}

const rowClass =
  'type-tree-row flex h-tree-row w-full min-w-0 items-center gap-2 rounded-component px-2 text-left hover:bg-row-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

export function useRecentSessions(folder: WorkspaceFolder): RecentSession[] {
  const history = useTerminalWorkspace((state) => state.history)
  const now = useRecentClock()
  return history
    .filter(
      (item): item is RecentSession =>
        item.project === folder.path &&
        item.providerSessionId !== null &&
        item.closedAt !== null &&
        item.closedAt >= now - TERMINAL_WORKSPACE_RECENT_MS
    )
    .toSorted((a, b) => b.closedAt - a.closedAt)
}

function RecentRow({ session, now }: { session: RecentSession; now: number }): React.JSX.Element {
  const name = session.title ?? session.providerSessionId.slice(0, 8)
  const identity = `${AGENT_PROVIDERS[session.provider]} ${session.provider === 'hatfield' ? '#' : ''}${session.providerSessionId}`
  const resume = () => void resumeRecent(session, false)
  return (
    <li>
      <ContextMenu>
        <Tooltip>
          <ContextMenuTrigger asChild>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={`Resume ${name}`}
                onClick={resume}
                className={cn(rowClass, 'group text-muted-foreground hover:text-foreground')}
              >
                <AgentProviderIcon
                  provider={session.provider}
                  className="size-4 opacity-70 group-hover:opacity-100"
                />
                <span className={cn('min-w-0 flex-1 truncate', !session.title && 'type-hint')}>
                  {name}
                </span>
                {session.branch ? (
                  <span className="type-hint flex max-w-24 shrink-0 items-center gap-1">
                    <GitBranch className="size-3 shrink-0" aria-hidden />
                    <span className="truncate">{session.branch}</span>
                  </span>
                ) : null}
                <span className="type-hint shrink-0 tabular-nums group-hover:hidden">
                  {closedAgo(session.closedAt, now)}
                </span>
                <Play className="hidden size-3.5 shrink-0 group-hover:block" aria-hidden />
              </button>
            </TooltipTrigger>
          </ContextMenuTrigger>
          <TooltipContent className="max-w-72 break-words">
            {session.title ? `${session.title} · ` : ''}
            {identity} · closed {closedAgo(session.closedAt, now)}
          </TooltipContent>
        </Tooltip>
        <ContextMenuContent>
          <ContextMenuItem onSelect={resume}>
            <Play aria-hidden />
            Resume
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void resumeRecent(session, true)}>
            <Columns2 aria-hidden />
            Resume in Split
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              void window.desktop
                .writeTerminalClipboard(session.providerSessionId)
                .catch(() => notify({ severity: 'error', title: 'Could not copy session ID' }))
            }}
          >
            <Copy aria-hidden />
            Copy session ID
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={() =>
              void window.desktop
                .forgetTerminalConversation(session.id)
                .catch(() =>
                  notify({ severity: 'error', title: 'Could not remove session from Recent' })
                )
            }
          >
            <Trash2 aria-hidden />
            Remove from Recent
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </li>
  )
}

export function RecentSessions({
  folder,
  sessions
}: {
  folder: WorkspaceFolder
  sessions: RecentSession[]
}): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  const now = useRecentClock()
  const [shown, setShown] = useState(RECENT_FIRST_PAGE)
  if (sessions.length === 0) return null
  const visible = sessions.slice(0, shown)
  const remaining = sessions.length - visible.length
  return (
    <li className="pl-5.5">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => setExpanded(!expanded)}
        className="type-hint flex h-tree-row w-full items-center gap-2 rounded-component px-1 text-muted-foreground hover:bg-row-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <ChevronRight className={cn('size-4 shrink-0', expanded && 'rotate-90')} aria-hidden />
        <span>Recent</span>
        <span className="tabular-nums">{sessions.length}</span>
      </button>
      <ul
        id={listId}
        aria-label={`${folder.name} recent sessions`}
        hidden={!expanded}
        className="pl-4"
      >
        {expanded
          ? visible.map((session) => <RecentRow key={session.id} session={session} now={now} />)
          : null}
        {expanded && remaining > 0 ? (
          <li>
            <button
              type="button"
              onClick={() => setShown(shown + RECENT_PAGE)}
              className="type-hint flex h-tree-row items-center rounded-component px-2 text-link hover:bg-row-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              Show {Math.min(RECENT_PAGE, remaining)} more
            </button>
          </li>
        ) : null}
        {expanded && remaining === 0 ? (
          <li>
            <span className="type-hint flex h-tree-row items-center gap-1.5 px-2 text-muted-foreground">
              <Search className="size-3 shrink-0" aria-hidden />
              Older than {RECENT_WINDOW_DAYS} days: memory search not available yet
            </span>
          </li>
        ) : null}
      </ul>
    </li>
  )
}
