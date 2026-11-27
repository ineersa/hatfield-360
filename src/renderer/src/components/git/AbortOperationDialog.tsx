import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import type { GitOperation } from '../../../../shared/source-control-api'
import { abortConsequence, OPERATION_NAMES } from './operation-notice'

/** Confirms aborting a group's operation, saying what is lost; Cancel has focus, nothing runs until Abort. */
export function AbortOperationDialog({
  name,
  operation,
  onConfirm,
  onClose
}: {
  /** The repository's name. */
  name: string
  operation: GitOperation
  onConfirm: () => void
  onClose: () => void
}): React.JSX.Element {
  const { noun, title } = OPERATION_NAMES[operation]
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogTitle>{`Abort the ${noun} in ${name}?`}</AlertDialogTitle>
        <AlertDialogDescription>
          {abortConsequence(operation)} This can&apos;t be undone.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction primary onClick={onConfirm}>
            {`Abort ${title}`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
