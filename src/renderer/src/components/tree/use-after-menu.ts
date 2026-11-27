import { useRef } from 'react'

/**
 * A menu action that runs once the menu has closed, keeping focus from returning to the row:
 * the field it moves focus to keeps it.
 */
export function useAfterMenu(): {
  choose: (action: () => void) => void
  onCloseAutoFocus: (event: Event) => void
} {
  const chosen = useRef<(() => void) | null>(null)
  return {
    choose: (action) => {
      chosen.current = action
    },
    onCloseAutoFocus: (event) => {
      const action = chosen.current
      if (!action) return
      event.preventDefault()
      chosen.current = null
      action()
    }
  }
}
