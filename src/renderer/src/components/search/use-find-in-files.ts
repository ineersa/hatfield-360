import { useEffect } from 'react'
import { appCommandForKey } from '@/lib/keymap-match'
import { useKeymapStore } from '@/state/keymap-store'
import { useSearchStore } from '@/state/search-store'
import { useWorkspaceStore } from '@/state/workspace-store'
import type { WorkspaceView } from '../../../../shared/workspace-api'

const folderKey = (workspace: WorkspaceView | null): string =>
  (workspace?.folders ?? []).map((folder) => folder.path).join('\0')

/** Find in Files' results from main, and its key from anywhere in the window: the editor, a panel or a terminal. */
export function useFindInFiles(): void {
  useEffect(() => useSearchStore.getState().connect(), [])
  useEffect(
    () =>
      useWorkspaceStore.subscribe((state, previous) => {
        if (folderKey(state.workspace) !== folderKey(previous.workspace)) {
          useSearchStore.getState().workspaceChanged()
        }
      }),
    []
  )
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // The file tree takes the key first, to search the folders selected in it.
      if (event.defaultPrevented) return
      if (appCommandForKey(event, useKeymapStore.getState().shell) !== 'find-in-files') return
      event.preventDefault()
      useSearchStore.getState().findInFiles()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
