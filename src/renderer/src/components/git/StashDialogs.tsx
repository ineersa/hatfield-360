import { useId, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { agoText } from '@/lib/elapsed-time'
import { useSourceControlStore } from '@/state/source-control-store'
import { type StashDialog, useStashStore } from '@/state/stash-store'
import { MAX_STASH_MESSAGE_LENGTH, type StashEntry } from '../../../../shared/stash-api'
import { ChangedFileList } from './ChangedFileList'

const STASH_ROW =
  'type-body flex h-tree-row shrink-0 cursor-pointer items-center gap-2 rounded-component px-2 hover:bg-row-hover has-checked:bg-selection has-focus-visible:ring-2 has-focus-visible:ring-ring'

const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`

/** Names the files a stash takes and asks for its message; nothing is stashed until Stash. */
function StashChangesDialog({
  dialog
}: {
  dialog: Extract<StashDialog, { kind: 'stash' }>
}): React.JSX.Element {
  const stash = useStashStore((state) => state.stash)
  const close = useStashStore((state) => state.close)
  const busy = useSourceControlStore((state) => state.running !== null)
  const [message, setMessage] = useState('')
  const { group, files, untracked } = dialog.target
  const submit = (): void => {
    if (!busy) void stash(message)
  }
  return (
    <AlertDialog open onOpenChange={(open) => !open && close()}>
      <AlertDialogContent>
        <AlertDialogTitle>Stash Changes</AlertDialogTitle>
        <ChangedFileList
          label="Files to stash"
          targets={[{ group, files: [...files, ...untracked] }]}
        />
        <AlertDialogDescription>
          {`Puts ${count(files.length + untracked.length, 'file')} of ${group.name} aside and returns ${files.length + untracked.length === 1 ? 'it' : 'them'} to the last commit${untracked.length > 0 ? ' (a new file leaves the disk)' : ''}. Other changes stay. Unstash Changes brings ${files.length + untracked.length === 1 ? 'it' : 'them'} back.`}
        </AlertDialogDescription>
        <Input
          aria-label="Stash message"
          autoFocus
          placeholder="Message (optional)"
          maxLength={MAX_STASH_MESSAGE_LENGTH}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            submit()
          }}
        />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction primary disabled={busy} onClick={submit}>
            Stash
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** The working tree's stashes, newest first, one chosen to view, apply, pop or drop. */
function UnstashDialog({
  dialog
}: {
  dialog: Extract<StashDialog, { kind: 'unstash' }>
}): React.JSX.Element {
  const close = useStashStore((state) => state.close)
  const unstash = useStashStore((state) => state.unstash)
  const view = useStashStore((state) => state.view)
  const openDrop = useStashStore((state) => state.openDrop)
  const busy = useSourceControlStore((state) => state.running !== null)
  const [picked, setPicked] = useState<string | null>(null)
  const labelId = useId()
  const { group, stashes, problem } = dialog
  const chosen: StashEntry | undefined =
    stashes?.find((entry) => entry.id === picked) ?? stashes?.[0]
  // Ages as of opening: the list is a moment's look.
  const [now] = useState(Date.now)
  return (
    <AlertDialog open onOpenChange={(open) => !open && close()}>
      <AlertDialogContent>
        <AlertDialogTitle id={labelId}>{`Unstash Changes · ${group.name}`}</AlertDialogTitle>
        {stashes === null ? (
          <p className="type-body flex items-center gap-2">
            <Spinner className="size-4" aria-hidden />
            Reading the stashes…
          </p>
        ) : problem !== null ? (
          <p role="alert" className="type-body text-error">
            {`Couldn't read the stashes: ${problem}`}
          </p>
        ) : stashes.length === 0 ? (
          <AlertDialogDescription>{`${group.name} has no stashes.`}</AlertDialogDescription>
        ) : (
          <>
            <div
              role="radiogroup"
              aria-labelledby={labelId}
              className="flex max-h-64 flex-col overflow-y-auto"
            >
              {stashes.map((entry) => (
                <label key={entry.id} className={STASH_ROW}>
                  <input
                    type="radio"
                    name="stash"
                    value={entry.id}
                    checked={entry.id === chosen?.id}
                    onChange={() => setPicked(entry.id)}
                    className="sr-only"
                  />
                  <span className="min-w-0 truncate">{entry.message}</span>
                  <span className="type-hint ml-auto shrink-0 pl-2">
                    {[
                      entry.detached ? 'detached HEAD' : entry.branch,
                      agoText(entry.createdAt, now)
                    ]
                      .filter((part) => part !== null)
                      .join(' · ')}
                  </span>
                </label>
              ))}
            </div>
            <AlertDialogDescription>
              Apply brings the changes back and keeps the stash; Pop also removes it. A conflict
              keeps the stash and lists the files to resolve.
            </AlertDialogDescription>
          </>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{chosen ? 'Cancel' : 'Close'}</AlertDialogCancel>
          {chosen ? (
            <>
              <AlertDialogAction onClick={() => view(chosen)}>View</AlertDialogAction>
              <AlertDialogAction
                disabled={busy}
                onClick={(event) => {
                  event.preventDefault()
                  openDrop(chosen)
                }}
              >
                Drop…
              </AlertDialogAction>
              <AlertDialogAction disabled={busy} onClick={() => void unstash(chosen, false)}>
                Apply
              </AlertDialogAction>
              <AlertDialogAction primary disabled={busy} onClick={() => void unstash(chosen, true)}>
                Pop
              </AlertDialogAction>
            </>
          ) : null}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Confirms dropping a stash: git keeps no easy way back. */
function DropStashDialog({
  dialog
}: {
  dialog: Extract<StashDialog, { kind: 'drop' }>
}): React.JSX.Element {
  const close = useStashStore((state) => state.close)
  const drop = useStashStore((state) => state.drop)
  const busy = useSourceControlStore((state) => state.running !== null)
  return (
    <AlertDialog open onOpenChange={(open) => !open && close()}>
      <AlertDialogContent>
        <AlertDialogTitle>{`Drop “${dialog.stash.message}”?`}</AlertDialogTitle>
        <AlertDialogDescription>
          {`The stash leaves ${dialog.group.name} with its changes. This can't be undone from here.`}
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel autoFocus>Cancel</AlertDialogCancel>
          <AlertDialogAction primary disabled={busy} onClick={() => void drop()}>
            Drop
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** The Stash, Unstash or Drop dialog the Commit panel asked for. */
export function StashDialogs(): React.JSX.Element | null {
  const dialog = useStashStore((state) => state.dialog)
  if (dialog === null) return null
  if (dialog.kind === 'stash')
    return <StashChangesDialog key={dialog.target.group.root} dialog={dialog} />
  return dialog.kind === 'unstash' ? (
    <UnstashDialog key={dialog.group.root} dialog={dialog} />
  ) : (
    <DropStashDialog key={dialog.stash.id} dialog={dialog} />
  )
}
