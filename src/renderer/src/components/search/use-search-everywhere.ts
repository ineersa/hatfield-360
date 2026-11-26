import { useEffect } from 'react'
import { DoubleShiftPress } from '@/lib/double-shift-press'
import { appCommandForKey } from '@/lib/keymap-match'
import { useKeymapStore } from '@/state/keymap-store'
import { useSearchEverywhereStore } from '@/state/search-everywhere-store'
import type { SearchEverywhereKind } from '../../../../shared/search-everywhere-api'

const GO_TO: Partial<Record<string, SearchEverywhereKind>> = {
  'search-everywhere': 'all',
  'go-to-file': 'files',
  'go-to-class': 'classes',
  'go-to-symbol': 'symbols'
}

/** Search Everywhere on Shift Shift from anywhere in the window, and Go to File / Class / Symbol on their keys. */
export function useSearchEverywhere(): void {
  useEffect(() => {
    const press = new DoubleShiftPress()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!press.keyDown(event)) return
      const store = useSearchEverywhereStore.getState()
      if (!store.open) store.show('all')
    }
    const onKeyUp = (event: KeyboardEvent): void => press.keyUp(event)
    const reset = (): void => press.reset()
    // Capture, so the editor and terminals see the keys too but can't keep them from the popup.
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('pointerdown', reset, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('pointerdown', reset, true)
    }
  }, [])
  useEffect(() => {
    // Bubble phase: a key the editor or a terminal's shell takes (readline's Ctrl+N) stays theirs.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return
      const command = appCommandForKey(event, useKeymapStore.getState().shell)
      const kind = command === null ? undefined : GO_TO[command]
      if (kind === undefined) return
      event.preventDefault()
      useSearchEverywhereStore.getState().show(kind)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
