import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import type { ChangedFile } from '../../../../shared/source-control-api'
import type { GitGroup } from './change-tree-rows'
import { ChangedFileList } from './ChangedFileList'

/** Confirms rolling tracked changes back, naming each one; nothing is done until Roll Back. */
export function RollbackDialog({
  targets,
  onConfirm,
  onClose
}: {
  targets: { group: GitGroup; files: ChangedFile[] }[]
  onConfirm: () => void
  onClose: () => void
}): React.JSX.Element {
  const count = targets.reduce((sum, target) => sum + target.files.length, 0)
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogTitle>{`Roll back ${count} ${count === 1 ? 'file' : 'files'}?`}</AlertDialogTitle>
        <ChangedFileList label="Files to roll back" targets={targets} />
        <AlertDialogDescription>
          Each file goes back to how it is in the last commit: an added file is deleted, a deleted
          one comes back. This can&apos;t be undone.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction primary onClick={onConfirm}>
            Roll Back
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
