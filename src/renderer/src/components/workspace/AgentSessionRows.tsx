import claudeCodeIcon from '@/assets/claudecode-color.svg'
import hatfieldIcon from '@/assets/hatfield-plushie.svg'
import { cn } from '@/lib/class-names'
import { Activity, Check, MessageCircle, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  AGENT_PROVIDERS,
  type AgentSession,
  type AgentSnapshot
} from '../../../../shared/agent-api'
import { terminalTabControllers } from '@/components/terminal/terminal-tab-controllers'
import { useTerminalStore } from '@/state/terminal-store'
import { mainErrorMessage } from '@/lib/main-error-message'

export function useAgentSessions() {
  const [snapshot, setSnapshot] = useState<AgentSnapshot>({ revision: -1, sessions: [] })
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let mounted = true
    const receive = (next: AgentSnapshot) => {
      if (!mounted) return
      setSnapshot((current) => (next.revision > current.revision ? next : current))
      setError(null)
    }
    const stop = window.desktop.subscribeAgentSessions(receive)
    void window.desktop.getAgentSessions().then(receive, (failure: unknown) => {
      if (mounted) setError(mainErrorMessage(failure))
    })
    return () => {
      mounted = false
      stop()
    }
  }, [])
  return { sessions: snapshot.sessions.toSorted((a, b) => b.updatedAt - a.updatedAt), error }
}

function selectTerminal(id: string): void {
  for (const [tabId, controller] of terminalTabControllers) {
    if (!controller.selectTerminal(id)) continue
    useTerminalStore.getState().activateTab(tabId)
    return
  }
}

function sessionDescription(session: AgentSession): string {
  if (session.wait) return `Needs input: ${waitLabel(session)}`
  if (session.activity === 'working') return session.tool ? `Working · ${session.tool}` : 'Working'
  if (session.activity === 'idle') return 'Idle'
  return 'Running'
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
  stopped: { icon: X, color: 'text-muted-foreground', label: 'Stopped' }
} as const

function isStopped(session: AgentSession): boolean {
  return (
    session.process === 'exited' ||
    (session.activity === 'idle' &&
      !session.wait &&
      (session.outcome === 'failed' || session.outcome === 'cancelled'))
  )
}

export type SessionFilter = keyof typeof statuses
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

function relativeTime(now: number, at: number): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000)
  if (!minutes) return 'Now'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`
  return `${Math.floor(minutes / 1440)}d`
}

function activeTerminalId(state: ReturnType<typeof useTerminalStore.getState>): string | null {
  return state.activeTabId ? (state.paneByTab[state.activeTabId] ?? null) : null
}

export function AgentAttention({
  sessions,
  projectName
}: {
  sessions: AgentSession[]
  projectName: (project: string | null) => string
}): React.JSX.Element {
  return (
    <section aria-label="Attention" className="border-b border-separator px-2 pb-1">
      <h3 className="type-section-title flex h-tree-row items-center gap-2 px-2 text-warning">
        <MessageCircle className="size-3" aria-hidden /> Needs input ({sessions.length})
      </h3>
      <ul
        aria-label="Sessions needing input"
        className="h-control overflow-y-auto"
        tabIndex={sessions.length > 1 ? 0 : undefined}
      >
        {sessions.length === 0 && (
          <li className="type-hint flex h-tree-row items-center px-2">No sessions need input</li>
        )}
        {sessions.map((session) => (
          <li key={session.id}>
            <button
              type="button"
              aria-label={`${AGENT_PROVIDERS[session.provider]} session · Needs input: ${waitLabel(session)}`}
              onClick={() => selectTerminal(session.terminalId)}
              className="type-hint flex h-tree-row w-full items-center gap-2 rounded-component px-2 text-left hover:bg-row-hover focus-visible:bg-selection-inactive focus-visible:outline-none"
            >
              <MessageCircle className="size-3.5 shrink-0 text-warning" aria-hidden />
              <span className="min-w-0 flex-1 truncate">Needs input: {waitLabel(session)}</span>
              <span className="max-w-24 truncate">{projectName(session.project)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function AgentSessionRows({
  sessions,
  now
}: {
  sessions: AgentSession[]
  now: number
}): React.JSX.Element {
  const selected = useTerminalStore(activeTerminalId)
  return (
    <>
      {sessions.map((session) => {
        const provider = AGENT_PROVIDERS[session.provider]
        const title = `${provider} session${session.providerSessionId ? ` · ${session.providerSessionId}` : ''}`
        const state = isStopped(session)
          ? 'stopped'
          : session.wait
            ? 'attention'
            : session.activity === 'unknown'
              ? null
              : session.activity
        const status = state ? statuses[state] : null
        const counts = [
          session.runningChildren
            ? `${session.runningChildren} ${session.runningChildren === 1 ? 'agent' : 'agents'} running`
            : null,
          session.runningScripts
            ? `${session.runningScripts} ${session.runningScripts === 1 ? 'script' : 'scripts'} running`
            : null
        ]
          .filter(Boolean)
          .join(' · ')
        const detail = [
          provider,
          state === 'stopped' ? 'Stopped' : sessionDescription(session),
          session.outcome && `Last turn: ${outcomes[session.outcome].toLowerCase()}`
        ]
          .filter(Boolean)
          .join(' · ')
        const current = selected === session.terminalId
        const time = relativeTime(now, session.updatedAt)
        return (
          <li key={session.id} className="pl-tree-indent">
            <button
              type="button"
              aria-current={current || undefined}
              onClick={() => selectTerminal(session.terminalId)}
              className={cn(
                'flex w-full min-w-0 items-center gap-2 rounded-component px-2 py-1.5 text-left hover:bg-row-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                current && 'bg-selection text-selection-foreground hover:bg-selection'
              )}
            >
              <img
                src={session.provider === 'hatfield' ? hatfieldIcon : claudeCodeIcon}
                alt=""
                className="size-4 shrink-0 object-contain"
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="type-tree-row block truncate" title={title}>
                  {title}
                </span>
                <span
                  className={cn('type-hint block truncate', current && 'text-selection-foreground')}
                  title={detail}
                >
                  {detail}
                </span>
                <span
                  className={cn(
                    'type-hint block truncate',
                    current ? 'text-selection-foreground' : 'text-info'
                  )}
                  title={counts || undefined}
                >
                  {counts || '\u00a0'}
                </span>
              </span>
              {status ? (
                <status.icon className={cn('size-3.5 shrink-0', status.color)} aria-hidden />
              ) : (
                <span className="size-3.5 shrink-0" aria-hidden />
              )}
              <time
                className={cn(
                  'type-hint shrink-0 tabular-nums',
                  current && 'text-selection-foreground'
                )}
                dateTime={new Date(session.updatedAt).toISOString()}
                title={new Date(session.updatedAt).toLocaleString()}
              >
                {time}
              </time>
            </button>
          </li>
        )
      })}
    </>
  )
}
