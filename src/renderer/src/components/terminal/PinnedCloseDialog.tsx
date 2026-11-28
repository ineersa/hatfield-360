import { AgentProviderIcon } from '@/components/icons/AgentProviderIcon'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import {
  agentSessionIdentity,
  sessionState,
  statuses
} from '@/components/workspace/AgentSessionRows'
import { cn } from '@/lib/class-names'
import { answerPinnedClose, usePinnedCloseStore } from '@/state/pinned-close'

/** Asks before a close ends pinned sessions; Keep Open is the default, so Enter and Escape keep them. */
export function PinnedCloseDialog(): React.JSX.Element {
  const pending = usePinnedCloseStore((state) => state.pending)
  const sessions = pending?.sessions ?? []
  const many = sessions.length > 1
  const working = sessions.some((session) => session.activity === 'working')
  return (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) answerPinnedClose(false)
      }}
    >
      <AlertDialogContent>
        <AlertDialogTitle>
          {many ? `Close ${sessions.length} pinned sessions?` : 'Close pinned session?'}
        </AlertDialogTitle>
        <AlertDialogDescription>
          Closing ends {many ? 'these sessions' : 'this session'}.{' '}
          {working ? 'A response in progress stops. ' : ''}
          {many ? 'The conversations stay' : 'The conversation stays'} in Recent, so you can resume
          later.
        </AlertDialogDescription>
        <ul aria-label="Pinned sessions to close" className="flex flex-col gap-1">
          {sessions.map((session) => {
            const state = sessionState(session)
            const status = state ? statuses[state] : null
            return (
              <li
                key={session.id}
                className="type-body flex min-w-0 items-center gap-2 rounded-component border border-separator px-2.5 py-1.5"
              >
                <AgentProviderIcon provider={session.provider} className="size-4" />
                <span className="min-w-0 flex-1 truncate">
                  {agentSessionIdentity(session).displayName}
                </span>
                {status ? (
                  <span className={cn('type-hint flex shrink-0 items-center gap-1', status.color)}>
                    <status.icon className="size-3.5" aria-hidden />
                    {status.label}
                  </span>
                ) : null}
              </li>
            )
          })}
        </ul>
        <AlertDialogFooter>
          <AlertDialogAction onClick={() => answerPinnedClose(true)}>
            Unpin and Close
          </AlertDialogAction>
          <AlertDialogCancel primary>Keep Open</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
