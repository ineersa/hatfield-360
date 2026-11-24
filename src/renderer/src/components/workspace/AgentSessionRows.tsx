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
import { Activity, Check, Copy, MessageCircle, SquareTerminal, Users, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  AGENT_PROVIDERS,
  type AgentSession,
  type AgentSnapshot
} from '../../../../shared/agent-api'
import { closeTerminal, selectTerminal } from '@/components/terminal/terminal-tab-controllers'
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

function sessionDescription(session: AgentSession): string {
  if (session.process === 'unknown') return 'Process status unavailable'
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

function activeTerminalId(state: ReturnType<typeof useTerminalStore.getState>): string | null {
  return state.activeTabId ? (state.paneByTab[state.activeTabId] ?? null) : null
}

export function AgentSessionRows({ sessions }: { sessions: AgentSession[] }): React.JSX.Element {
  const selected = useTerminalStore(activeTerminalId)
  return (
    <>
      {sessions.map((session) => {
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
        const accessibleName = id
          ? `${provider} ${session.provider === 'hatfield' ? '#' : ''}${id}`
          : `${provider} · ID not reported`
        const state = isStopped(session)
          ? 'stopped'
          : session.wait
            ? 'attention'
            : session.activity === 'unknown'
              ? null
              : session.activity
        const status = state ? statuses[state] : null
        const label = status?.label ?? sessionDescription(session)
        const detail = [
          accessibleName,
          title,
          state === 'stopped' ? 'Stopped' : sessionDescription(session),
          session.outcome && `Last foreground response: ${outcomes[session.outcome].toLowerCase()}`,
          session.runningChildren !== null && `Active agents: ${session.runningChildren}`,
          session.runningScripts !== null && `Background scripts: ${session.runningScripts}`,
          session.cwd
        ]
          .filter(Boolean)
          .join(' · ')
        const current = selected === session.terminalId
        const go = () => {
          if (!selectTerminal(session.terminalId))
            notify({ severity: 'warning', title: 'Terminal is no longer available' })
        }
        return (
          <li key={session.id} className="pl-tree-indent">
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
                        'type-tree-row flex h-tree-row w-full min-w-0 items-center gap-1.5 rounded-component px-2 text-left hover:bg-row-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                        current && 'ring-1 ring-inset ring-ring'
                      )}
                    >
                      <AgentProviderIcon provider={session.provider} />
                      <span className="min-w-0 flex-1 truncate">{displayName}</span>
                      {session.runningChildren ? (
                        <span className="type-hint flex shrink-0 items-center gap-0.5" aria-hidden>
                          <Users className="size-3.5" />
                          {session.runningChildren}
                        </span>
                      ) : null}
                      {session.runningScripts ? (
                        <span className="type-hint flex shrink-0 items-center gap-0.5">
                          <SquareTerminal
                            role="img"
                            aria-label="Background scripts"
                            className="size-3.5"
                          />
                          {session.runningScripts}
                        </span>
                      ) : null}
                      <span
                        className={cn(
                          'flex min-w-24 shrink-0 items-center justify-end gap-1',
                          status?.color ?? 'text-muted-foreground'
                        )}
                      >
                        {status ? <status.icon className="size-4 shrink-0" aria-hidden /> : null}
                        <span className="truncate">
                          {session.process === 'unknown' && !status ? 'Unknown' : label}
                        </span>
                      </span>
                    </button>
                  </TooltipTrigger>
                </ContextMenuTrigger>
                <TooltipContent className="max-w-72 break-words">{detail}</TooltipContent>
              </Tooltip>
              <ContextMenuContent>
                <ContextMenuItem onSelect={go}>
                  <SquareTerminal aria-hidden />
                  Go to terminal
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
                    if (!closeTerminal(session.terminalId))
                      notify({ severity: 'warning', title: 'Terminal is no longer available' })
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
