import { useEffect, useState } from 'react'
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
import { fileName } from './editor-tab-labels'

const answer = (proceed: boolean): void => {
  window.desktop
    .answerCloseRequest(proceed)
    .catch((error: unknown) => console.error('Answering the close request failed:', error))
}

/**
 * Asks what to do with unsaved editor tabs when the window closes or the app quits, as JetBrains
 * IDEs do. Main asks only while a tab has unsaved changes, which this keeps it told of.
 */
export function UnsavedChangesDialog(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const tabs = useEditorTabStore((state) => state.tabs)
  const dirty = tabs.filter((tab) => tab.dirty)
  const unsaved = dirty.length > 0

  useEffect(() => {
    window.desktop
      .setUnsavedChanges(unsaved)
      .catch((error: unknown) => console.error('Reporting unsaved changes failed:', error))
  }, [unsaved])

  useEffect(() => window.desktop.subscribeCloseRequest(() => setOpen(true)), [])

  const saveAll = async (): Promise<void> => {
    setSaving(true)
    let saved = false
    try {
      // Loaded with the editor, which any unsaved tab already has.
      const { saveAllDocuments } = await import('./editor-documents')
      saved = await saveAllDocuments()
    } catch (error) {
      console.error('Saving before closing failed:', error)
    } finally {
      setSaving(false)
    }
    // A failed save has said why; the window stays open with the changes.
    if (!saved) return
    setOpen(false)
    answer(true)
  }

  const names = dirty.map((tab) => fileName(tab.path))
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (next || saving) return
        setOpen(false)
        answer(false)
      }}
    >
      <AlertDialogContent>
        <AlertDialogTitle>
          {names.length === 1
            ? `Save changes to ${names[0] ?? ''} before closing?`
            : `Save changes to ${names.length} files before closing?`}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {names.length > 1 ? `${names.join(', ')}. ` : ''}Your changes will be lost if you close
          without saving them.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogAction
            className="mr-auto"
            disabled={saving}
            onClick={(event) => {
              event.preventDefault()
              setOpen(false)
              answer(true)
            }}
          >
            Don't Save
          </AlertDialogAction>
          <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            primary
            autoFocus
            disabled={saving}
            // Stays open until every file is written, so nothing can be edited meanwhile.
            onClick={(event) => {
              event.preventDefault()
              void saveAll()
            }}
          >
            {names.length === 1 ? 'Save' : 'Save All'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
