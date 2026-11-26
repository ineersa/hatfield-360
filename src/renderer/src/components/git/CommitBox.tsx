import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '@/components/ui/action-button-classes'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { rendererPlatform } from '@/lib/shortcut-keys'
import { useSourceControlStore } from '@/state/source-control-store'

const COMMIT_KEY = rendererPlatform === 'darwin' ? '⌘↩' : 'Ctrl+Enter'

/**
 * A commit button that stays focusable and hoverable while it can't act (aria-disabled), so its
 * tooltip can say why.
 */
function CommitButton({
  label,
  className,
  busy,
  blocked,
  tip,
  onClick
}: {
  label: string
  className: string
  busy: boolean
  /** Why it can't act now, or null when it can. */
  blocked: string | null
  tip: string
  onClick: () => void
}): React.JSX.Element {
  const unavailable = blocked !== null || busy
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-disabled={unavailable || undefined}
          aria-busy={busy || undefined}
          onClick={() => {
            if (!unavailable) onClick()
          }}
          className={className}
        >
          {busy ? <Spinner className="size-4" aria-hidden /> : null}
          {label}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{blocked ?? tip}</TooltipContent>
    </Tooltip>
  )
}

/** The commit message, Amend, and Commit / Commit and Push, at the bottom of the Commit panel. */
export function CommitBox({ checkedCount }: { checkedCount: number }): React.JSX.Element {
  const message = useSourceControlStore((state) => state.message)
  const amend = useSourceControlStore((state) => state.amend)
  const running = useSourceControlStore((state) => state.running)
  const setMessage = useSourceControlStore((state) => state.setMessage)
  const setAmend = useSourceControlStore((state) => state.setAmend)
  const commit = useSourceControlStore((state) => state.commit)
  const blocked =
    message.trim() === ''
      ? 'Write a commit message'
      : checkedCount === 0 && !amend
        ? 'Check the files to commit'
        : running !== null
          ? 'Wait for the current action to finish'
          : null
  const files = checkedCount === 1 ? '1 file' : `${checkedCount} files`
  const what = amend
    ? checkedCount === 0
      ? 'Change the last commit’s message'
      : `Amend the last commit with ${files}`
    : `Commit ${files}`

  return (
    <div className="flex shrink-0 flex-col gap-2 border-t border-separator p-2">
      <label className="type-body flex w-fit items-center gap-2 select-none">
        <input
          type="checkbox"
          checked={amend}
          disabled={running !== null}
          onChange={(event) => void setAmend(event.target.checked)}
          className="accent-primary"
        />
        Amend
      </label>
      <Textarea
        aria-label="Commit message"
        placeholder="Commit message"
        rows={3}
        spellCheck={false}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return
          event.preventDefault()
          if (blocked === null) void commit(false)
        }}
        className="max-h-60 resize-none bg-input text-input-foreground field-sizing-fixed"
      />
      <div className="flex flex-wrap items-center gap-2">
        <CommitButton
          label="Commit"
          className={PRIMARY_BUTTON}
          busy={running === 'commit'}
          blocked={blocked}
          tip={`${what} (${COMMIT_KEY})`}
          onClick={() => void commit(false)}
        />
        <CommitButton
          label="Commit and Push"
          className={SECONDARY_BUTTON}
          busy={running === 'commit-push'}
          blocked={blocked}
          tip={`${what}, then push`}
          onClick={() => void commit(true)}
        />
      </div>
    </div>
  )
}
