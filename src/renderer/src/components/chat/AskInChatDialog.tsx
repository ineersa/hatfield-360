import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { useChatStore } from '@/state/chat-store'

/** Asks before Ask in Chat ends the chat the panel has. */
export function AskInChatDialog(): React.JSX.Element {
  const asking = useChatStore((state) => state.asking)
  const busy = useChatStore((state) => state.status === 'busy')
  const settleAsk = useChatStore((state) => state.settleAsk)
  return (
    <AlertDialog
      open={asking !== null}
      onOpenChange={(open) => {
        if (!open) settleAsk(false)
      }}
    >
      <AlertDialogContent>
        <AlertDialogTitle>End the current chat?</AlertDialogTitle>
        <AlertDialogDescription>
          {busy ? 'The agent is still answering. ' : ''}
          Asking about this hunk starts a new chat, and the current one ends with its messages.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep Chat</AlertDialogCancel>
          <AlertDialogAction onClick={() => settleAsk(true)}>Start New Chat</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
