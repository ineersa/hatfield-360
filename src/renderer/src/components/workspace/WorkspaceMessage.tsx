import { MessageBar } from '@/components/shell/MessageBar'
import { useWorkspaceStore } from '@/state/workspace-store'

/** Why the last workspace action failed. */
export function WorkspaceMessage(): React.JSX.Element | null {
  const error = useWorkspaceStore((state) => state.error)
  const notice = useWorkspaceStore((state) => {
    const current = state.workspace?.notice
    return current && current.id !== state.dismissedNoticeId ? current.message : null
  })
  const dismiss = useWorkspaceStore((state) => state.dismissMessage)
  const message = error ?? notice
  if (!message) return null
  return <MessageBar label="Workspace message" message={message} onDismiss={dismiss} />
}
