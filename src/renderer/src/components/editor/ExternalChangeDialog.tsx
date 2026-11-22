import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { useEditorTabStore } from '@/state/editor-tab-store'
import { cancelConflict, keepEdits, loadDiskVersion } from './editor-documents'
import { fileName } from './editor-tab-labels'

/**
 * Asks which version stays when a tab with unsaved edits finds its file changed on disk: seen
 * there, or found by a save, which then wrote nothing. The active tab is asked about first, and only
 * while the Files view shows (`hidden` otherwise); the question waits until then.
 */
export function ExternalChangeDialog({ hidden }: { hidden: boolean }): React.JSX.Element {
  const tabs = useEditorTabStore((state) => state.tabs)
  const activePath = useEditorTabStore((state) => state.activePath)
  const conflicted = tabs.filter((tab) => tab.conflict !== null)
  const tab = conflicted.find((each) => each.path === activePath) ?? conflicted[0]
  const name = tab ? fileName(tab.path) : ''
  const onSave = tab?.conflict === 'save'

  return (
    <AlertDialog
      open={tab !== undefined && !hidden}
      onOpenChange={(open) => {
        // Escape cancels a save; a change seen on disk needs an answer.
        if (!open && tab && onSave) cancelConflict(tab.path)
      }}
    >
      <AlertDialogContent
        onEscapeKeyDown={(event) => {
          if (!onSave) event.preventDefault()
        }}
      >
        <AlertDialogTitle>{name} changed on disk</AlertDialogTitle>
        <AlertDialogDescription>
          {onSave
            ? `It changed since it was opened, so it wasn't saved. Overwrite it with your version, or load the version on disk and lose your changes?`
            : `Keep your unsaved changes (saving will overwrite the file), or load the version on disk and lose them?`}
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogAction
            className="mr-auto"
            onClick={() => {
              if (tab) loadDiskVersion(tab.path)
            }}
          >
            Load Disk Version
          </AlertDialogAction>
          {onSave ? <AlertDialogCancel>Cancel</AlertDialogCancel> : null}
          <AlertDialogAction
            primary
            autoFocus
            onClick={() => {
              if (tab) keepEdits(tab.path)
            }}
          >
            {onSave ? 'Overwrite' : 'Keep My Version'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
