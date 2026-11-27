import { CircleStop, Sparkles, Undo2 } from 'lucide-react'
import { PanelHeaderButton } from '@/components/shell/PanelHeaderButton'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '@/components/ui/action-button-classes'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { rendererPlatform } from '@/lib/shortcut-keys'
import { actionRunning, useSourceControlStore } from '@/state/source-control-store'
import {
  amendTarget,
  commitLabel,
  commitPlan,
  concludesOperation,
  generatePlan,
  gitGroups
} from './commit-plan'
import { OPERATION_NAMES } from './operation-notice'

/** The message box's id, for Commit File… to put focus in it. */
export const COMMIT_MESSAGE_ID = 'commit-message'

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
export function CommitBox(): React.JSX.Element {
  const groups = useSourceControlStore((state) => state.groups)
  const checked = useSourceControlStore((state) => state.checked)
  const selectedRoot = useSourceControlStore((state) => state.selected?.root ?? null)
  const message = useSourceControlStore((state) => state.message)
  const amend = useSourceControlStore((state) => state.amend)
  const running = useSourceControlStore((state) => state.running)
  const cancelling = useSourceControlStore((state) => state.cancelling)
  const cancel = useSourceControlStore((state) => state.cancel)
  const setMessage = useSourceControlStore((state) => state.setMessage)
  const setAmend = useSourceControlStore((state) => state.setAmend)
  const commit = useSourceControlStore((state) => state.commit)
  const generating = useSourceControlStore((state) => state.generating)
  const generateMessage = useSourceControlStore((state) => state.generateMessage)
  const cancelGenerate = useSourceControlStore((state) => state.cancelGenerate)
  const generated = useSourceControlStore((state) => state.generated)
  const restorePrevious = useSourceControlStore((state) => state.restorePrevious)
  const generate = generatePlan(groups ?? [], checked, selectedRoot, amend, actionRunning(running))
  const plan = commitPlan(groups ?? [], checked, selectedRoot, amend)
  const checkedCount = plan.work.reduce((sum, target) => sum + target.files.length, 0)
  const target = amendTarget(groups ?? [], checked, selectedRoot)
  // With several repositories, Amend says whose last commit it replaces.
  const amendLabel =
    gitGroups(groups).length > 1 && target !== null && target !== 'several'
      ? `Amend last commit in ${target.group.name}`
      : 'Amend'
  // Git can't amend in the middle of an operation: it would leave it half done.
  const amendBlocked =
    target !== null && target !== 'several' && target.group.operation !== null
      ? `Amend isn't available during the ${OPERATION_NAMES[target.group.operation.kind].noun} in ${target.group.name}`
      : null
  const concluding = plan.work.filter(({ group }) => concludesOperation(group))
  const blocked =
    plan.blocked ??
    (generating
      ? 'Wait for the message being written'
      : message.trim() === ''
        ? 'Write a commit message'
        : plan.work.length === 0
          ? 'Check the files to commit'
          : running !== null
            ? 'Wait for the current action to finish'
            : null)
  const files = checkedCount === 1 ? '1 file' : `${checkedCount} files`
  const [concluded] = concluding
  const what = amend
    ? checkedCount === 0
      ? 'Change the last commit’s message'
      : `Amend the last commit with ${files}`
    : concluding.length === 1 && concluded?.group.operation
      ? `Conclude the ${OPERATION_NAMES[concluded.group.operation.kind].noun} in ${concluded.group.name}: commit everything it staged${checkedCount === 0 ? '' : ` and ${files}`}`
      : `Commit ${files}`

  return (
    <div className="flex shrink-0 flex-col gap-2 border-t border-separator p-2">
      <div className="flex items-center justify-between gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <label className="type-body flex w-fit items-center gap-2 select-none has-disabled:text-muted-foreground">
              <input
                type="checkbox"
                checked={amend}
                disabled={running !== null || generating || (amendBlocked !== null && !amend)}
                aria-description={amendBlocked ?? undefined}
                onChange={(event) => void setAmend(event.target.checked)}
                className="accent-primary"
              />
              {amendLabel}
            </label>
          </TooltipTrigger>
          {amendBlocked === null ? null : (
            <TooltipContent side="top">{amendBlocked}</TooltipContent>
          )}
        </Tooltip>
        <span className="flex items-center gap-1">
          {generated !== null && generated.message === message && !generating ? (
            <PanelHeaderButton label="Restore Previous Message" onClick={restorePrevious}>
              <Undo2 className="size-4" strokeWidth={1.75} aria-hidden />
            </PanelHeaderButton>
          ) : null}
          {generating ? (
            <PanelHeaderButton label="Stop Generating" onClick={cancelGenerate}>
              <CircleStop className="size-4" strokeWidth={1.75} aria-hidden />
            </PanelHeaderButton>
          ) : (
            <PanelHeaderButton
              label="Generate Commit Message"
              disabled={generate.blocked !== null}
              tip={
                generate.blocked ??
                (amend
                  ? 'Write a message for the amended commit with an agent'
                  : 'Write a message for the checked files with an agent')
              }
              onClick={() => void generateMessage()}
            >
              <Sparkles className="size-4" strokeWidth={1.75} aria-hidden />
            </PanelHeaderButton>
          )}
        </span>
      </div>
      <Textarea
        id={COMMIT_MESSAGE_ID}
        aria-label="Commit message"
        placeholder={generating ? 'Writing a commit message…' : 'Commit message'}
        rows={3}
        spellCheck={false}
        readOnly={generating}
        aria-busy={generating || undefined}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return
          event.preventDefault()
          if (blocked === null) void commit(false)
        }}
        className="max-h-60 resize-none bg-input text-input-foreground field-sizing-fixed"
      />
      {plan.note === null ? null : <p className="type-hint">{plan.note}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <CommitButton
          label={commitLabel(plan.work)}
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
        {running === null || running === 'refresh' || running === 'ignore' ? null : (
          <CommitButton
            label={cancelling ? 'Cancelling…' : 'Cancel'}
            className={SECONDARY_BUTTON}
            busy={false}
            blocked={cancelling ? 'Stopping git and everything it started' : null}
            tip="Stop the running git command, its hooks and ssh"
            onClick={() => void cancel()}
          />
        )}
      </div>
    </div>
  )
}
