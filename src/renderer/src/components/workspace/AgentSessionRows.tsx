import { focusActiveTerminal } from '@/components/terminal/use-terminal-commands'
import { AgentProviderIcon } from '@/components/icons/AgentProviderIcon'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { notify } from '@/state/notification-store'
import { cn } from '@/lib/class-names'
import {
  Activity,
  AlarmClock,
  Check,
  Copy,
  MessageCircle,
  Pin,
  PinOff,
  Repeat,
  SquareTerminal,
  Users,
  X
} from 'lucide-react'
import { useRef } from 'react'
import { AGENT_PROVIDERS, type AgentSession } from '../../../../shared/agent-api'
import { useAgentSessionStore } from '@/state/agent-session-store'
import { isPinned } from '@/state/pinned-sessions'
import { pinKey } from '../../../../shared/pinned-session'
import { closeTerminal, selectTerminal } from '@/components/terminal/terminal-tab-controllers'
import { useTerminalStore } from '@/state/terminal-store'
import { mainErrorMessage } from '@/lib/main-error-message'

export function useAgentSessions() {
  const sessions = useAgentSessionStore((state) => state.sessions)
  const error = useAgentSessionStore((state) => state.error)
  return { sessions, error }
}

function sessionDescription(session: AgentSession): string {
  if (session.process === 'unknown') return 'Process status unavailable'
  if (session.wait) return `Needs input: ${waitLabel(session)}`
  if (session.activity === 'working') return session.tool ? `Working · ${session.tool}` : 'Working'
  if (session.activity === 'idle') return isScheduled(session) ? 'Scheduled' : 'Idle'
  return 'Activity not reported'
}

function isScheduled(session: AgentSession): boolean {
  return session.process !== 'exited' && (session.schedules?.length ?? 0) > 0
}

function runTime(at: number): string {
  const when = new Date(at)
  const time = when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return when.toDateString() === new Date().toDateString()
    ? time
    : `${when.toLocaleDateString([], { weekday: 'short' })} ${time}`
}

function nextRun(session: AgentSession): number | null {
  const times = (session.schedules ?? []).flatMap(({ nextRunAt }) =>
    nextRunAt === null ? [] : [nextRunAt]
  )
  return times.length ? Math.min(...times) : null
}

function scheduleDetail(session: AgentSession): string[] {
  return (session.schedules ?? []).map(({ label, recurring, nextRunAt }) =>
    [
      `Schedule: ${label}`,
      recurring ? 'repeats' : 'runs once',
      nextRunAt === null ? 'next run unknown' : `next ${runTime(nextRunAt)}`
    ].join(', ')
  )
}

function waitLabel(session: AgentSession): string {
  return session.wait === 'external-input' ? 'external input' : (session.wait ?? '')
}

const outcomes = {
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  unknown: 'Outcome unknown'
} as const

export const statuses = {
  working: { icon: Activity, color: 'text-info', label: 'Working' },
  attention: { icon: MessageCircle, color: 'text-warning', label: 'Needs input' },
  idle: { icon: Check, color: 'text-success', label: 'Idle' },
  scheduled: { icon: AlarmClock, color: 'text-foreground', label: 'Scheduled' },
  stopped: { icon: X, color: 'text-error', label: 'Stopped' }
} as const

// A failed iteration of a pending schedule will run again, so the session isn't stopped.
function isStopped(session: AgentSession): boolean {
  return (
    session.process === 'exited' ||
    (session.activity === 'idle' &&
      !session.wait &&
      !isScheduled(session) &&
      (session.outcome === 'failed' || session.outcome === 'cancelled'))
  )
}

export type SessionFilter = Exclude<keyof typeof statuses, 'scheduled'>
export function matchesStatus(session: AgentSession, filter: SessionFilter): boolean {
  if (session.process === 'exited') return filter === 'stopped'
  switch (filter) {
    case 'attention':
      return session.wait !== null
    case 'working':
      return session.activity === 'working'
    case 'idle':
      return session.activity === 'idle' && !session.wait && !isStopped(session)
    default:
      return isStopped(session)
  }
}

/** The status a session row shows, or null while activity isn't reported. */
export function sessionState(session: AgentSession): keyof typeof statuses | null {
  if (isStopped(session)) return 'stopped'
  if (session.wait) return 'attention'
  if (session.activity === 'unknown') return null
  return session.activity === 'idle' && isScheduled(session) ? 'scheduled' : session.activity
}

function activeTerminalId(state: ReturnType<typeof useTerminalStore.getState>): string | null {
  return state.activeTabId ? (state.paneByTab[state.activeTabId] ?? null) : null
}

export function agentSessionIdentity(
  session: Pick<AgentSession, 'provider' | 'providerSessionId' | 'title'>
) {
  const provider = AGENT_PROVIDERS[session.provider]
  const id = session.providerSessionId
  const identity = id
    ? session.provider === 'hatfield'
      ? `#${id}`
      : id.slice(0, 8)
    : 'ID not reported'
  const title = session.title?.trim()
  const displayName = title
    ? session.provider === 'hatfield' && id
      ? `${identity} — ${title}`
      : title
    : identity
  const providerIdentity = id
    ? `${provider} ${session.provider === 'hatfield' ? '#' : ''}${id}`
    : `${provider} · ID not reported`
  return { title, displayName, providerIdentity }
}

export function AgentSessionRows({
  sessions,
  projectName
}: {
  sessions: AgentSession[]
  /** Names each row's project, for a list that mixes projects. */
  projectName?: (session: AgentSession) => string
}): React.JSX.Element {
  const selected = useTerminalStore(activeTerminalId)
  const pinned = useTerminalStore((state) => state.pinned)
  const setPinned = useTerminalStore((state) => state.setPinned)
  const focusAfterMenu = useRef<string | null>(null)
  const closeAfterMenu = useRef<(() => void) | null>(null)
  return (
    <>
      {sessions.map((session) => {
        const id = session.providerSessionId
        const { title, displayName, providerIdentity } = agentSessionIdentity(session)
        // The hatfield number is the row's handle, not its content, so it reads quieter than the title.
        const prefix = title && displayName !== title ? displayName.slice(0, -title.length) : null
        const state = sessionState(session)
        const status = state ? statuses[state] : null
        const next = state === 'scheduled' ? nextRun(session) : null
        const label = next === null ? status?.label : `${status?.label} · next ${runTime(next)}`
        const scheduleCount = session.schedules?.length ?? 0
        const repeatCount =
          state === 'scheduled' ? (scheduleCount > 1 ? scheduleCount : 0) : scheduleCount
        const accessibleName = [providerIdentity, title, label].filter(Boolean).join(' · ')
        const detail = [
          providerIdentity,
          title,
          state === 'stopped' ? 'Stopped' : sessionDescription(session),
          session.outcome &&
            `Last ${session.trigger === 'schedule' ? 'scheduled run' : 'foreground response'}: ${outcomes[session.outcome].toLowerCase()}`,
          ...scheduleDetail(session),
          session.runningChildren !== null && `Active agents: ${session.runningChildren}`,
          session.runningScripts !== null && `Background scripts: ${session.runningScripts}`,
          session.worktree && session.worktree !== session.cwd && `Worktree: ${session.worktree}`,
          session.cwd
        ]
          .filter(Boolean)
          .join(' · ')
        const current = selected === session.terminalId
        const key = session.process === 'running' ? pinKey(session) : null
        const sessionPinned = isPinned(session, pinned)
        const project = projectName?.(session)
        const go = () => {
          if (selectTerminal(session.terminalId)) return true
          notify({ severity: 'warning', title: 'Terminal is no longer available' })
          return false
        }
        return (
          <li key={session.id}>
            <ContextMenu>
              <Tooltip>
                <ContextMenuTrigger asChild>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={accessibleName}
                      aria-description={detail}
                      aria-current={current || undefined}
                      onClick={go}
                      className={cn(
                        'type-tree-row flex w-full min-w-0 items-center gap-2 rounded-component px-2 py-1 text-left hover:bg-row-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                        current && 'bg-selection-inactive hover:bg-selection-inactive'
                      )}
                    >
                      <AgentProviderIcon
                        provider={session.provider}
                        className="size-session-icon"
                      />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate">
                          {prefix ? (
                            <>
                              <span className="text-muted-foreground">{prefix}</span>
                              {title}
                            </>
                          ) : (
                            displayName
                          )}
                        </span>
                        {status ||
                        session.runningChildren ||
                        session.runningScripts ||
                        repeatCount ? (
                          <span className="type-hint flex min-w-0 items-center gap-2.5 text-muted-foreground">
                            {status ? (
                              <span className={cn('flex min-w-0 items-center gap-1', status.color)}>
                                <status.icon className="size-3.5 shrink-0" aria-hidden />
                                <span className="truncate">{label}</span>
                              </span>
                            ) : null}
                            {repeatCount ? (
                              <span className="flex shrink-0 items-center gap-0.5">
                                <Repeat role="img" aria-label="Schedules" className="size-3.5" />
                                {repeatCount}
                              </span>
                            ) : null}
                            {session.runningChildren ? (
                              <span className="flex shrink-0 items-center gap-0.5" aria-hidden>
                                <Users className="size-3.5" />
                                {session.runningChildren}
                              </span>
                            ) : null}
                            {session.runningScripts ? (
                              <span className="flex shrink-0 items-center gap-0.5">
                                <SquareTerminal
                                  role="img"
                                  aria-label="Background scripts"
                                  className="size-3.5"
                                />
                                {session.runningScripts}
                              </span>
                            ) : null}
                          </span>
                        ) : null}
                      </span>
                      {project ? (
                        <span className="type-hint max-w-24 shrink-0 truncate text-muted-foreground">
                          {project}
                        </span>
                      ) : null}
                    </button>
                  </TooltipTrigger>
                </ContextMenuTrigger>
                <TooltipContent className="max-w-72 break-words">{detail}</TooltipContent>
              </Tooltip>
              <ContextMenuContent
                onCloseAutoFocus={(event) => {
                  const close = closeAfterMenu.current
                  if (close) {
                    // Run once the menu has let go of focus, so a confirmation keeps it.
                    closeAfterMenu.current = null
                    event.preventDefault()
                    close()
                    return
                  }
                  if (focusAfterMenu.current !== session.id) return
                  focusAfterMenu.current = null
                  event.preventDefault()
                  setTimeout(focusActiveTerminal, 0)
                }}
              >
                <ContextMenuItem
                  onSelect={() => {
                    if (go()) focusAfterMenu.current = session.id
                  }}
                >
                  <SquareTerminal aria-hidden />
                  Go to terminal
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={key === null}
                  onSelect={() => {
                    if (key) setPinned(key, !sessionPinned)
                  }}
                >
                  {sessionPinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
                  {sessionPinned ? 'Unpin Session' : 'Pin Session'}
                </ContextMenuItem>
                {id ? (
                  <ContextMenuItem
                    onSelect={() =>
                      void window.desktop.writeTerminalClipboard(id).catch((error: unknown) =>
                        notify({
                          severity: 'error',
                          title: 'Could not copy session ID',
                          body: mainErrorMessage(error)
                        })
                      )
                    }
                  >
                    <Copy aria-hidden />
                    Copy session ID
                  </ContextMenuItem>
                ) : null}
                <ContextMenuItem
                  onSelect={() => {
                    closeAfterMenu.current = () => {
                      if (!closeTerminal(session.terminalId))
                        notify({ severity: 'warning', title: 'Terminal is no longer available' })
                    }
                  }}
                >
                  <X aria-hidden />
                  Close terminal
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          </li>
        )
      })}
    </>
  )
}
