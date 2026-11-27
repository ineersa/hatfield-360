import { useEffect } from 'react'
import { appCommandForKey } from '@/lib/keymap-match'
import { useChatStore } from '@/state/chat-store'
import { useKeymapStore } from '@/state/keymap-store'

/** The chat's events from main, and New Chat's key (Ctrl/Cmd+Shift+L) from anywhere in the window. */
export function useChatShortcut(): void {
  useEffect(() => useChatStore.getState().connect(), [])
  useEffect(() => {
    // Capture, before a focused terminal or the editor takes the key.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (appCommandForKey(event, useKeymapStore.getState().shell) !== 'new-chat') return
      event.preventDefault()
      event.stopPropagation()
      useChatStore.getState().openNewChat()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])
}
