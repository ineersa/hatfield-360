import { cn } from '@/lib/class-names'

const BUTTON =
  'type-button flex h-control items-center justify-center gap-2 rounded-button px-3.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-disabled:cursor-default aria-disabled:opacity-50'

/** The default choice: the accent fill, as JetBrains draws a dialog's default button. */
export const PRIMARY_BUTTON = cn(
  BUTTON,
  'bg-primary text-primary-foreground hover:bg-primary/90 aria-disabled:hover:bg-primary'
)

export const SECONDARY_BUTTON = cn(
  BUTTON,
  'border border-button-border bg-button text-button-foreground hover:bg-hover aria-disabled:hover:bg-button'
)
