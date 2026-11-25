import { useEffect } from 'react'
import { useChatStore } from '@/state/chat-store'

/** The longest pause between the two Shift presses, as in JetBrains' Search Everywhere. */
const DOUBLE_PRESS_MS = 400

/** The chat's events from main, and Shift Shift from anywhere in the window for a new one. */
export function useChatShortcut(): void {
  useEffect(() => useChatStore.getState().connect(), [])
  useEffect(() => {
    // A lone Shift press, released; another lone press soon after opens a new chat.
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
        useChatStore.getState().openNewChat()
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
    // Capture, so the editor and terminals see the keys too but can't keep them from the chat.
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('pointerdown', reset, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('pointerdown', reset, true)
    }
  }, [])
}
