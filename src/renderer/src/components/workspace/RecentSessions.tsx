import { ChevronRight, Columns2, Copy, GitBranch, Play, Search } from 'lucide-react'
import { useId, useState } from 'react'
import { AgentProviderIcon } from '@/components/icons/AgentProviderIcon'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/class-names'
import { useMemorySearchStore } from '@/state/memory-search-store'
import { notify } from '@/state/notification-store'
import {
  RECENT_CONVERSATION_MS,
  type RecentConversation,
  conversationKey
} from '../../../../shared/recent-conversation'
import type { AgentSession } from '../../../../shared/agent-api'
import { agentSessionIdentity } from './AgentSessionRows'
import { resumeRecentConversation } from '@/components/terminal/resume-recent-conversation'
import { agoText, elapsedSince } from '@/lib/elapsed-time'
import { mainErrorMessage } from '@/lib/main-error-message'

const RECENT_PAGE = 20

function reportError(error: unknown): void {
  notify({
    severity: 'error',
    title: 'Recent session action failed',
    body: mainErrorMessage(error)
  })
}

const rowClass =
  'type-tree-row flex h-tree-row w-full min-w-0 items-center gap-2 rounded-component px-2 text-left hover:bg-row-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

function RecentRow({
  session,
  projectBranch,
  generation,
  live,
  now
}: {
  session: RecentConversation
  projectBranch: string | null
  generation: number
  live: AgentSession[]
  now: number
}): React.JSX.Element {
  const { title, displayName, providerIdentity: identity } = agentSessionIdentity(session)
  const name = title ?? displayName
  const resume = () => resumeRecentConversation(session, generation, false, live)
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
                {session.branch && session.branch !== projectBranch ? (
                  <span className="type-hint flex min-w-0 items-center gap-1">
                    <GitBranch className="size-3 shrink-0" aria-hidden />
                    <span className="truncate">{session.branch}</span>
                  </span>
                ) : null}
                <span className="type-hint shrink-0 tabular-nums group-hover:hidden">
                  {elapsedSince(session.lastModified, now)}
                </span>
                <Play className="hidden size-3.5 shrink-0 group-hover:block" aria-hidden />
              </button>
            </TooltipTrigger>
          </ContextMenuTrigger>
          <TooltipContent className="max-w-72 break-words">
            {session.title ? `${session.title} · ` : ''}
            {identity} · last active {agoText(session.lastModified, now)}
          </TooltipContent>
        </Tooltip>
        <ContextMenuContent>
          <ContextMenuItem onSelect={resume}>
            <Play aria-hidden />
            Resume
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => resumeRecentConversation(session, generation, true, live)}
          >
            <Columns2 aria-hidden />
            Resume in Split
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() =>
              void window.desktop
                .writeTerminalClipboard(session.providerSessionId)
                .catch(reportError)
            }
          >
            <Copy aria-hidden />
            Copy session ID
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </li>
  )
}

export function RecentSessions({
  project,
  name,
  projectBranch,
  generation,
  sessions,
  live,
  now
}: {
  /** The project whose memory the hint for older sessions searches; null for none. */
  project: string | null
  name: string
  projectBranch: string | null
  generation: number
  sessions: RecentConversation[]
  live: AgentSession[]
  now: number
}): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  const [shown, setShown] = useState(5)
  const recent = sessions.filter((session) => session.lastModified > now - RECENT_CONVERSATION_MS)
  if (recent.length === 0) return null
  const visible = recent.slice(0, shown)
  const remaining = recent.length - visible.length
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
        <span className="tabular-nums">{recent.length}</span>
      </button>
      <ul id={listId} aria-label={`${name} recent sessions`} hidden={!expanded} className="pl-4">
        {expanded
          ? visible.map((session) => (
              <RecentRow
                key={conversationKey(session)}
                session={session}
                projectBranch={projectBranch}
                generation={generation}
                live={live}
                now={now}
              />
            ))
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
        {expanded && remaining === 0 && project !== null ? (
          <li>
            <button
              type="button"
              onClick={() => useMemorySearchStore.getState().open(project)}
              className="type-hint flex h-tree-row items-center gap-1.5 rounded-component px-2 text-muted-foreground hover:bg-row-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <Search className="size-3 shrink-0" aria-hidden />
              Older than 14 days: search memory
            </button>
          </li>
        ) : null}
      </ul>
    </li>
  )
}
