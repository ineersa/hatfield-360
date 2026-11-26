import { CircleAlert, X } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import type { ActionFailure } from '@/state/source-control-store'

/** What failed and where, with git's (and its hooks') output as it printed it. */
export function ActionFailureNotice({
  failure,
  onDismiss
}: {
  failure: ActionFailure
  onDismiss: () => void
}): React.JSX.Element {
  return (
    <div className="shrink-0 px-2 pb-2">
      <Alert className="border-error-border bg-error-background pr-9">
        <CircleAlert className="text-error" aria-hidden />
        <AlertTitle className="type-section-title line-clamp-none">{failure.title}</AlertTitle>
        <AlertDescription className="w-full min-w-0">
          {failure.output.trim() === '' ? (
            <p>Git printed nothing.</p>
          ) : (
            <pre
              aria-label="Git output"
              tabIndex={0}
              className="type-hint max-h-48 w-full overflow-auto font-mono break-words whitespace-pre-wrap text-foreground select-text focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
            >
              {failure.output.replace(/\s+$/, '')}
            </pre>
          )}
        </AlertDescription>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="absolute top-2 right-2 flex size-small-icon-button items-center justify-center rounded-button text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </Alert>
    </div>
  )
}
