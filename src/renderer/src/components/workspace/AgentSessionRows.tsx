import {
  Circle,
  CircleAlert,
  CircleCheck,
  LoaderCircle,
  Sparkles,
  SquareTerminal
} from 'lucide-react'
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
  if (session.process === 'exited') return 'Exited'
  if (session.wait === 'permission') return 'Needs input: permission'
  if (session.wait === 'question') return 'Needs input: question'
  if (session.wait === 'external-input') return 'Needs input: external input'
  if (session.activity === 'working') return session.tool ? `Working · ${session.tool}` : 'Working'
  if (session.activity === 'idle') return 'Idle'
  return 'Running · status unavailable'
}

const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const outcomes = {
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  unknown: 'Outcome unknown'
} as const

export function AgentSessionRows({ sessions }: { sessions: AgentSession[] }): React.JSX.Element {
  return (
    <>
      {sessions.map((session) => {
        const provider = AGENT_PROVIDERS[session.provider]
        const title = `${provider} session${session.providerSessionId ? ` · ${session.providerSessionId}` : ''}`
        const ProviderIcon = session.provider === 'claude' ? Sparkles : SquareTerminal
        const StatusIcon =
          session.wait || session.outcome === 'failed'
            ? CircleAlert
            : session.activity === 'working'
              ? LoaderCircle
              : session.outcome === 'completed'
                ? CircleCheck
                : Circle
        const description = sessionDescription(session)
        const detail = session.outcome
          ? `${description} · ${outcomes[session.outcome]}`
          : description
        return (
          <li key={session.id}>
            <button
              type="button"
              className="flex w-full min-w-0 items-start gap-2 rounded-component py-1.5 pr-2 pl-tree-indent text-left hover:bg-row-hover focus-visible:bg-selection-inactive focus-visible:outline-none"
              onClick={() => selectTerminal(session.terminalId)}
            >
              <ProviderIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="type-tree-row block truncate" title={title}>
                  {title}
                </span>
                <span
                  className="type-hint flex min-w-0 items-center gap-1"
                  title={`${provider} · ${detail}`}
                >
                  <StatusIcon
                    className={session.wait ? 'size-3 shrink-0 text-warning' : 'size-3 shrink-0'}
                    aria-hidden
                  />
                  <span className="truncate">
                    {provider} · {detail}
                  </span>
                </span>
              </span>
              <time
                className="type-hint shrink-0 whitespace-nowrap"
                dateTime={new Date(session.updatedAt).toISOString()}
                title={new Date(session.updatedAt).toLocaleString()}
              >
                {clock.format(session.updatedAt)}
              </time>
            </button>
          </li>
        )
      })}
    </>
  )
}
