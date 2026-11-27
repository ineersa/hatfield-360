import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/class-names'
import type { ChangedFile } from '../../../../shared/source-control-api'
import type { GitGroup } from './change-tree-rows'
import { CHANGE_KINDS } from './ChangesTree'

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
  const several = targets.length > 1
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogTitle>{`Roll back ${count} ${count === 1 ? 'file' : 'files'}?`}</AlertDialogTitle>
        <ul aria-label="Files to roll back" className="flex max-h-48 flex-col overflow-y-auto">
          {targets.flatMap(({ group, files }) =>
            files.map((file) => {
              const kind = CHANGE_KINDS[file.kind]
              return (
                <li
                  key={`${group.root}\0${file.path}`}
                  className="type-body flex h-tree-row shrink-0 items-center gap-2"
                >
                  <span
                    className={cn('w-4 shrink-0 text-center font-mono', kind.text)}
                    title={kind.label}
                  >
                    {kind.letter}
                  </span>
                  <span className="min-w-0 truncate">{file.path}</span>
                  <span className="sr-only">{kind.label}</span>
                  {several ? (
                    <span className="type-hint ml-auto shrink-0 pl-2">{group.name}</span>
                  ) : null}
                </li>
              )
            })
          )}
        </ul>
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
