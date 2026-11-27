import type { ReactNode } from 'react'
import { useAfterMenu } from '@/components/tree/use-after-menu'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger
} from '@/components/ui/context-menu'

/** What a tab strip's right-click menu closes, and what else it offers for one tab. */
export type TabMenu = {
  /** Every tab of the strip, in order. */
  tabs: readonly string[]
  /** Closes these tabs, which a strip may first ask about. */
  close: (ids: string[]) => void
  closeShortcut?: string
  /** Tabs the bulk closes leave open, as browsers leave pinned tabs. */
  keep?: ReadonlySet<string>
  /** The tab's own items below the closing ones, run once the menu has closed. */
  renderItems?: (choose: (action: () => void) => void) => ReactNode
}

/** A tab's right-click menu, as in JetBrains IDEs: Close, Close Other Tabs, Close Tabs to the Right, Close All Tabs. */
export function TabContextMenu({
  id,
  menu,
  children
}: {
  id: string
  menu: TabMenu
  /** The tab; it takes the menu's trigger props. */
  children: ReactNode
}): React.JSX.Element {
  const { tabs, close, closeShortcut, keep, renderItems } = menu
  const afterMenu = useAfterMenu()
  const index = tabs.indexOf(id)
  const closable = keep ? tabs.filter((tab) => !keep.has(tab)) : [...tabs]
  const others = closable.filter((tab) => tab !== id)
  const right = tabs.slice(index + 1).filter((tab) => closable.includes(tab))
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent onCloseAutoFocus={afterMenu.onCloseAutoFocus}>
        <ContextMenuItem onSelect={() => afterMenu.choose(() => close([id]))}>
          Close
          {closeShortcut ? <ContextMenuShortcut>{closeShortcut}</ContextMenuShortcut> : null}
        </ContextMenuItem>
        <ContextMenuItem
          disabled={others.length === 0}
          onSelect={() => afterMenu.choose(() => close(others))}
        >
          Close Other Tabs
        </ContextMenuItem>
        <ContextMenuItem
          disabled={right.length === 0}
          onSelect={() => afterMenu.choose(() => close(right))}
        >
          Close Tabs to the Right
        </ContextMenuItem>
        <ContextMenuItem
          disabled={closable.length === 0}
          onSelect={() => afterMenu.choose(() => close(closable))}
        >
          Close All Tabs
        </ContextMenuItem>
        {renderItems ? (
          <>
            <ContextMenuSeparator />
            {renderItems(afterMenu.choose)}
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  )
}
