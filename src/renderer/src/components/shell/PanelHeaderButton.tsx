import type { ReactNode } from 'react'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/class-names'

/**
 * An icon button in a side panel's header, named by its tooltip. One that can't act stays
 * hoverable (aria-disabled), so its tooltip can say why.
 */
export function PanelHeaderButton({
  label,
  pressed,
  disabled = false,
  busy = false,
  onClick,
  tip,
  children
}: {
  label: string
  pressed?: boolean
  disabled?: boolean
  /** Its action is running: a spinner takes the icon's place. */
  busy?: boolean
  onClick: () => void
  tip?: ReactNode
  children: ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={pressed}
          aria-busy={busy || undefined}
          aria-disabled={disabled || undefined}
          disabled={busy}
          onClick={disabled ? undefined : onClick}
          className={cn(
            'flex size-icon-button items-center justify-center rounded-button text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
            !disabled && 'hover:bg-hover hover:text-foreground',
            pressed && 'bg-selection-inactive text-foreground',
            disabled && 'cursor-default opacity-40',
            busy && 'pointer-events-none'
          )}
        >
          {busy ? <Spinner className="size-4" aria-hidden /> : children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{tip ?? label}</TooltipContent>
    </Tooltip>
  )
}
