import { useEffect } from 'react'
import { appCommandForKey } from '@/lib/keymap-match'
import { useKeymapStore } from '@/state/keymap-store'
import { useSearchEverywhereStore } from '@/state/search-everywhere-store'
import type { SearchEverywhereKind } from '../../../../shared/search-everywhere-api'

/** The longest pause between the two Shift presses, as in JetBrains. */
const DOUBLE_PRESS_MS = 400

const GO_TO: Partial<Record<string, SearchEverywhereKind>> = {
  'search-everywhere': 'all',
  'go-to-file': 'files',
  'go-to-class': 'classes',
  'go-to-symbol': 'symbols'
}

/** Search Everywhere on Shift Shift from anywhere in the window, and Go to File / Class / Symbol on their keys. */
export function useSearchEverywhere(): void {
  useEffect(() => {
    // A lone Shift press, released; another lone press soon after opens the popup.
    let releasedAt: number | null = null
    let alone = false
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Shift') {
        alone = false
        releasedAt = null
        return
      }
      if (event.repeat) return
      if (releasedAt !== null && event.timeStamp - releasedAt <= DOUBLE_PRESS_MS) {
        releasedAt = null
        alone = false
        const store = useSearchEverywhereStore.getState()
        if (!store.open) store.show('all')
        return
      }
      alone = true
    }
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key !== 'Shift') return
      releasedAt = alone ? event.timeStamp : null
      alone = false
    }
    const reset = (): void => {
      releasedAt = null
      alone = false
    }
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
