import { FileText } from 'lucide-react'
import type { ReactNode } from 'react'
import { PathMenuItems } from '@/components/tree/PathMenuItems'
import { useAfterMenu } from '@/components/tree/use-after-menu'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger
} from '@/components/ui/context-menu'

/** A search result's right-click menu: Open, then the path items of its file. */
export function FileResultMenu({
  path,
  onOpen,
  children
}: {
  path: string
  onOpen: () => void
  /** The result row; it takes the menu's trigger props. */
  children: ReactNode
}): React.JSX.Element {
  const afterMenu = useAfterMenu()
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent onCloseAutoFocus={afterMenu.onCloseAutoFocus}>
        <ContextMenuItem onSelect={() => afterMenu.choose(onOpen)}>
          <FileText aria-hidden />
          Open
          <ContextMenuShortcut>Enter</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <PathMenuItems path={path} relative />
      </ContextMenuContent>
    </ContextMenu>
  )
}
