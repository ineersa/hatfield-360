import { useEffect } from 'react'
import { appCommandForKey } from '@/lib/keymap-match'
import { useKeymapStore } from '@/state/keymap-store'
import { useMemorySearchStore } from '@/state/memory-search-store'

/** Search Memory's key from anywhere, including a focused terminal, which must not receive it. */
export function useMemorySearchShortcut(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (appCommandForKey(event, useKeymapStore.getState().shell) !== 'search-memory') return
      event.preventDefault()
      event.stopPropagation()
      useMemorySearchStore.getState().open()
    }
    // Capture, so the key is stopped before a terminal or the editor sees it.
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])
}
