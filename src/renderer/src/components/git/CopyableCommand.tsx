import { Check, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { mainErrorMessage } from '@/lib/main-error-message'
import { notify } from '@/state/notification-store'

/** How long the check mark stays after copying. */
const COPIED_MS = 2000

/** A shell command to copy and run elsewhere: selectable, with a copy button. */
export function CopyableCommand({ command }: { command: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return undefined
    const timer = setTimeout(() => setCopied(false), COPIED_MS)
    return () => clearTimeout(timer)
  }, [copied])
  const copy = (): void => {
    // The clipboard is main's: the sandboxed page has no clipboard permission of its own.
    window.desktop
      .writeTerminalClipboard(command)
      .then(() => setCopied(true))
      .catch((error: unknown) =>
        notify({ severity: 'error', title: "Couldn't copy", body: mainErrorMessage(error) })
      )
  }
  return (
    <div className="flex min-h-control items-center gap-2 rounded-component border border-border bg-frame pr-1 pl-3">
      <code className="type-body min-w-0 flex-1 py-1 font-mono break-all select-text">
        {command}
      </code>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`Copy ${command}`}
            onClick={copy}
            className="flex size-small-icon-button shrink-0 items-center justify-center rounded-button text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {copied ? (
              <Check className="size-3.5 text-success" aria-hidden />
            ) : (
              <Copy className="size-3.5" aria-hidden />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{copied ? 'Copied' : 'Copy'}</TooltipContent>
      </Tooltip>
      <span aria-live="polite" className="sr-only">
        {copied ? 'Copied' : ''}
      </span>
    </div>
  )
}
