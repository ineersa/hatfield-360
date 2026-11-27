import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/class-names'

/** One tab in a terminal-style tab strip (inside a ScrollingTabList): icon, label and close button. */
export function StripTab({
  title,
  label,
  icon,
  active,
  tip,
  onActivate,
  onClose
}: {
  /** Accessible name; the close button is "Close <title>". */
  title: string
  label: string
  icon: ReactNode
  active: boolean
  tip: ReactNode
  onActivate: () => void
  onClose: () => void
}): React.JSX.Element {
  return (
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
            className="flex min-w-0 flex-1 items-center gap-2 pr-2 pl-3.5 leading-none outline-none focus-visible:underline"
          >
            {icon}
            <span className="truncate">{label}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{tip}</TooltipContent>
      </Tooltip>
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
    </div>
  )
}
