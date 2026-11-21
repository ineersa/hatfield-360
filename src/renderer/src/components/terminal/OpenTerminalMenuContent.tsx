import { SquareTerminal } from 'lucide-react'
import { type ReactNode, useRef } from 'react'
import { focusActiveTerminal } from '@/components/terminal/use-terminal-commands'
import { ContextMenuContent, ContextMenuItem } from '@/components/ui/context-menu'
import { useTerminalStore } from '@/state/terminal-store'

/** A tree row's right-click menu: Open Terminal Here first, then the row's own items. */
export function OpenTerminalMenuContent({
  cwd,
  disabled,
  children
}: {
  cwd: string
  disabled: boolean
  children?: ReactNode
}): React.JSX.Element {
  const openTerminal = useTerminalStore((state) => state.openTerminal)
  const openedTerminal = useRef(false)
  return (
    <ContextMenuContent
      onCloseAutoFocus={(event) => {
        if (!openedTerminal.current) return
        // The new terminal gets the keys, not the row the menu would return them to.
        event.preventDefault()
        openedTerminal.current = false
        setTimeout(focusActiveTerminal, 0)
      }}
    >
      <ContextMenuItem
        disabled={disabled}
        onSelect={() => {
          openedTerminal.current = true
          openTerminal(cwd)
        }}
      >
        <SquareTerminal aria-hidden />
        Open Terminal Here
      </ContextMenuItem>
      {children}
    </ContextMenuContent>
  )
}
