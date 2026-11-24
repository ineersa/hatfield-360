import { useEffect } from 'react'
import { appCommandForKey } from '@/lib/keymap-match'
import { useKeymapStore } from '@/state/keymap-store'
import { useSearchStore } from '@/state/search-store'

/** Find in Files' results from main, and its key from anywhere in the window: the editor, a panel or a terminal. */
export function useFindInFiles(): void {
  useEffect(() => useSearchStore.getState().connect(), [])
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
