import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { useFileTreeStore } from '@/state/file-tree-store'
import type { DirectoryEntry } from '../../../../shared/file-tree-api'

/** Confirms moving entries to the system trash, naming them; `onTrashed` runs once they have moved. */
export function TrashDialog({
  entries,
  onClose,
  onTrashed
}: {
  entries: Pick<DirectoryEntry, 'name' | 'path' | 'kind'>[]
  onClose: () => void
  onTrashed?: () => void
}): React.JSX.Element {
  const trash = useFileTreeStore((state) => state.trash)
  const [first] = entries
  const one = entries.length === 1
  const hasFolder = entries.some((entry) => entry.kind === 'directory')
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogTitle>
          {one && first
            ? `Delete ${first.kind === 'directory' ? 'folder' : 'file'} "${first.name}"?`
            : `Delete ${entries.length} items?`}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {`${one ? 'It moves' : 'They move'} to the system trash${hasFolder ? ', folders with everything in them' : ''}, and can be restored from there.`}
        </AlertDialogDescription>
        {one ? null : (
          <ul aria-label="Items to delete" className="type-hint max-h-40 overflow-y-auto">
            {entries.map((entry) => (
              <li key={entry.path} className="truncate">
                {entry.name}
              </li>
            ))}
          </ul>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            primary
            autoFocus
            onClick={() => void trash(entries.map((entry) => entry.path)).then(onTrashed)}
          >
            Move to Trash
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
