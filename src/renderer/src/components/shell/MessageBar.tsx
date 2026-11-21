import { CircleAlert, X } from 'lucide-react'

/** A dismissable problem shown above every view, so it can't hide in a closed panel. */
export function MessageBar({
  label,
  message,
  onDismiss
}: {
  label: string
  message: string
  onDismiss: () => void
}): React.JSX.Element {
  return (
    <div
      role="alert"
      aria-label={label}
      className="mx-island-gap mt-island-gap flex items-start gap-2 rounded-banner border border-error-border bg-error-background py-2 pr-1.5 pl-3 text-foreground"
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-error" aria-hidden />
      <p className="min-w-0 flex-1 py-px">{message}</p>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="flex size-small-icon-button shrink-0 items-center justify-center rounded-button text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  )
}
