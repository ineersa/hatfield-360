import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/class-names'
import { type TabMenu, TabContextMenu } from './TabContextMenu'

/** One tab in a terminal-style tab strip (inside a ScrollingTabList): icon, label and close button. */
export function StripTab({
  id,
  menu,
  title,
  label,
  icon,
  active,
  tip,
  onActivate,
  onClose,
  compact = false
}: {
  id: string
  menu: TabMenu
  /** Accessible name; the close button is "Close <title>". */
  title: string
  label: string
  icon: ReactNode
  active: boolean
  tip: ReactNode
  onActivate: () => void
  /** Without it the tab has no close button, as a pinned tab. */
  onClose?: () => void
  /** Only the icon shows; the label stays in the tooltip and the accessible name. */
  compact?: boolean
}): React.JSX.Element {
  return (
    <TabContextMenu id={id} menu={menu}>
      <div
        className={cn(
          'type-tab group flex max-w-60 min-w-0 shrink-0 items-stretch border-r border-separator select-none',
          active
            ? 'bg-island text-foreground'
            : 'text-muted-foreground hover:bg-tab-hover hover:text-foreground'
        )}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              role="tab"
              aria-label={title}
              aria-selected={active}
              onClick={onActivate}
              className={cn(
                'flex min-w-0 flex-1 items-center gap-2 leading-none outline-none focus-visible:underline',
                compact ? 'px-3 focus-visible:bg-hover' : 'pr-2 pl-3.5'
              )}
            >
              {icon}
              {compact ? null : <span className="truncate">{label}</span>}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{tip}</TooltipContent>
        </Tooltip>
        {onClose ? (
          <button
            type="button"
            aria-label={`Close ${title}`}
            onClick={onClose}
            className={cn(
              'group/close flex shrink-0 items-center pr-2 text-muted-foreground hover:text-foreground focus-visible:opacity-100',
              active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            )}
          >
            <span className="flex size-5 items-center justify-center rounded-button group-hover/close:bg-hover">
              <X className="size-3.5" aria-hidden />
            </span>
          </button>
        ) : null}
      </div>
    </TabContextMenu>
  )
}
