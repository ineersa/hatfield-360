import { MessageCircle } from 'lucide-react'
import { AgentProviderIcon } from '@/components/icons/AgentProviderIcon'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { selectTerminal } from '@/components/terminal/terminal-tab-controllers'
import { notify } from '@/state/notification-store'
import { cn } from '@/lib/class-names'
import type { AgentSession } from '../../../../shared/agent-api'
import type { WorkspaceFolder } from '../../../../shared/workspace-api'
import { agentSessionIdentity } from './AgentSessionRows'

const reasons = {
  question: 'Answer needed',
  permission: 'Approval needed',
  'external-input': 'Input needed'
}

export function AgentAttention({
  sessions,
  folders
}: {
  sessions: AgentSession[]
  folders: WorkspaceFolder[]
}): React.JSX.Element {
  const waiting = sessions.filter(
    (session) => session.wait !== null && session.process === 'running'
  )
  return (
    <section
      aria-label="Agents needing attention"
      className={cn(
        'mx-2 mb-2 min-h-0 shrink-0 rounded-component',
        waiting.length > 0 && 'bg-warning-background'
      )}
    >
      <h3
        className={cn(
          'type-section-title flex items-center gap-1.5 px-2 pt-2 pb-1',
          waiting.length > 0 ? 'text-warning' : 'text-muted-foreground'
        )}
      >
        <MessageCircle className="size-4 shrink-0" aria-hidden /> Needs input
        {waiting.length > 0 ? (
          <span>({waiting.length})</span>
        ) : (
          <span className="type-hint ml-auto">No requests</span>
        )}
      </h3>
      <ul aria-label="Unresolved requests" className="max-h-36 overflow-y-auto px-2 pb-1">
        {waiting.map((session) => {
          const { title, displayName, providerIdentity } = agentSessionIdentity(session)
          const project =
            folders.find((folder) => folder.path === session.project)?.name ?? 'Other terminals'
          return (
            <li key={session.id} className="flex min-w-0 items-center gap-2 py-1">
              <div className="min-w-0 flex-1">
                <p className="type-hint truncate text-warning">
                  {session.wait && reasons[session.wait]} · {project}
                </p>
                <div className="type-tree-row flex min-w-0 items-center gap-1.5">
                  <AgentProviderIcon provider={session.provider} />
                  <span className="truncate">{displayName}</span>
                </div>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={`Open terminal for ${displayName}`}
                    className="type-button h-control shrink-0 rounded-button px-1.5 text-warning hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    onClick={() => {
                      if (!selectTerminal(session.terminalId))
                        notify({ severity: 'warning', title: 'Terminal is no longer available' })
                    }}
                  >
                    Open terminal
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-72 break-words">
                  {[providerIdentity, title, project].filter(Boolean).join(' · ')}
                </TooltipContent>
              </Tooltip>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
