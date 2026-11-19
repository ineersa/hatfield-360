import { CircleAlert, X } from 'lucide-react'
import { useWorkspaceStore } from '@/state/workspace-store'

/** Why the last workspace action failed, shown above every view so it can't hide in a closed panel. */
export function WorkspaceMessage(): React.JSX.Element | null {
  const error = useWorkspaceStore((state) => state.error)
  const notice = useWorkspaceStore((state) => {
    const current = state.workspace?.notice
    return current && current.id !== state.dismissedNoticeId ? current.message : null
  })
  const dismiss = useWorkspaceStore((state) => state.dismissMessage)
  const message = error ?? notice
  if (!message) return null

  return (
    <div
      role="alert"
      aria-label="Workspace message"
      className="mx-1.5 mt-1.5 flex items-start gap-2 rounded-xl bg-island py-2 pr-1.5 pl-3 text-destructive"
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1 py-px">{message}</p>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={dismiss}
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  )
}
