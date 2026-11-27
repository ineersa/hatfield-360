import { useRef, useState } from 'react'
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
import { type BranchDialog, useSourceControlStore } from '@/state/source-control-store'

const GIT_OUTPUT =
  'type-hint max-h-40 w-full overflow-auto rounded-component border border-border p-2 font-mono break-words whitespace-pre-wrap text-foreground select-text'

function SwitchBranchDialog({
  dialog
}: {
  dialog: Extract<BranchDialog, { kind: 'switch' }>
}): React.JSX.Element {
  const switchBranch = useSourceControlStore((state) => state.switchBranch)
  const close = useSourceControlStore((state) => state.closeBranchDialog)
  const busy = useSourceControlStore((state) => state.running !== null)
  const { group, target, plan } = dialog
  const confirm = useRef<HTMLButtonElement>(null)
  return (
    <AlertDialog open onOpenChange={(open) => !open && close()}>
      <AlertDialogContent
        onOpenAutoFocus={(event) => {
          // Switching changes nothing git can't undo, so Enter confirms it.
          event.preventDefault()
          confirm.current?.focus()
        }}
      >
        <AlertDialogTitle>{`Switch to ${target.name}?`}</AlertDialogTitle>
        <AlertDialogDescription asChild>
          <ul className="flex flex-col gap-1.5">
            {plan.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            ref={confirm}
            primary
            disabled={busy}
            onClick={() => void switchBranch(group, target)}
          >
            Switch
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function NewBranchDialog({
  dialog
}: {
  dialog: Extract<BranchDialog, { kind: 'new' }>
}): React.JSX.Element {
  const createBranch = useSourceControlStore((state) => state.createBranch)
  const close = useSourceControlStore((state) => state.closeBranchDialog)
  const busy = useSourceControlStore((state) => state.running !== null)
  const creating = useSourceControlStore((state) => state.running === 'create-branch')
  const [name, setName] = useState('')
  const [switchTo, setSwitchTo] = useState(true)
  const [edited, setEdited] = useState(false)
  const from =
    dialog.start.kind === 'head'
      ? `the current ${dialog.group.branch === null ? 'commit' : `branch, ${dialog.group.branch}`}`
      : dialog.start.name
  const submit = (): void => {
    if (busy || name.trim() === '') return
    setEdited(false)
    void createBranch(name.trim(), switchTo)
  }
  const problem = edited ? null : dialog.problem
  return (
    <AlertDialog open onOpenChange={(open) => !open && close()}>
      <AlertDialogContent>
        <AlertDialogTitle>New Branch</AlertDialogTitle>
        <AlertDialogDescription>
          {`Creates the branch in ${dialog.group.name} at ${from}${
            switchTo
              ? ', then checks it out; your local changes go with it.'
              : `. ${dialog.group.branch === null ? 'The detached HEAD' : dialog.group.branch} stays checked out.`
          }${dialog.start.kind === 'remote' ? ` It doesn't track ${dialog.start.name}.` : ''}`}
        </AlertDialogDescription>
        <div className="flex flex-col gap-1.5">
          <Input
            aria-label="Branch name"
            aria-invalid={problem !== null}
            autoFocus
            spellCheck={false}
            placeholder="feature/name"
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              setEdited(true)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              submit()
            }}
          />
          {problem === null ? null : (
            <pre role="alert" aria-label="Git output" className={GIT_OUTPUT}>
              {problem}
            </pre>
          )}
          <label className="type-body flex w-fit items-center gap-2 select-none">
            <input
              type="checkbox"
              checked={switchTo}
              onChange={(event) => setSwitchTo(event.target.checked)}
              className="accent-primary"
            />
            Switch to it
          </label>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            primary
            disabled={busy || name.trim() === ''}
            onClick={(event) => {
              // It stays open until git has made the branch, to show why it couldn't.
              event.preventDefault()
              submit()
            }}
          >
            {creating ? <Spinner className="size-4" aria-hidden /> : null}
            Create
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function DeleteBranchDialog({
  dialog
}: {
  dialog: Extract<BranchDialog, { kind: 'delete' }>
}): React.JSX.Element {
  const deleteBranch = useSourceControlStore((state) => state.deleteBranch)
  const close = useSourceControlStore((state) => state.closeBranchDialog)
  const busy = useSourceControlStore((state) => state.running !== null)
  const deleting = useSourceControlStore((state) => state.running === 'delete-branch')
  const { name, refused } = dialog
  return (
    <AlertDialog open onOpenChange={(open) => !open && close()}>
      <AlertDialogContent>
        <AlertDialogTitle>
          {refused === null ? `Delete branch ${name}?` : `${name} is not fully merged`}
        </AlertDialogTitle>
        {refused === null ? (
          <AlertDialogDescription>
            {`The local branch is deleted in ${dialog.group.name}; a remote branch of the same name stays.`}
          </AlertDialogDescription>
        ) : (
          <>
            <pre aria-label="Git output" tabIndex={0} className={GIT_OUTPUT}>
              {refused.output.replace(/\s+$/, '') || 'Git printed nothing.'}
            </pre>
            {refused.commits.length === 0 ? (
              <AlertDialogDescription>
                Its commits are on other branches, so none would be lost.
              </AlertDialogDescription>
            ) : (
              <>
                <AlertDialogDescription>
                  These commits are on no other branch, tag or remote branch, and would be lost:
                </AlertDialogDescription>
                <ul
                  aria-label="Commits that would be lost"
                  className="flex max-h-40 flex-col overflow-y-auto"
                >
                  {refused.commits.map((commit) => (
                    <li
                      key={commit.hash}
                      className="type-body flex h-tree-row shrink-0 items-center gap-2"
                    >
                      <span className="shrink-0 font-mono text-muted-foreground">
                        {commit.hash}
                      </span>
                      <span className="min-w-0 truncate">{commit.subject}</span>
                    </li>
                  ))}
                  {refused.more > 0 ? (
                    <li className="type-hint shrink-0">{`and ${refused.more} more`}</li>
                  ) : null}
                </ul>
              </>
            )}
          </>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel autoFocus>Cancel</AlertDialogCancel>
          <AlertDialogAction
            primary
            disabled={busy}
            onClick={(event) => {
              // It stays open to ask about forcing it if git refuses.
              event.preventDefault()
              void deleteBranch(refused !== null)
            }}
          >
            {deleting ? <Spinner className="size-4" aria-hidden /> : null}
            {refused === null ? 'Delete' : 'Force Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** The Switch, New Branch or Delete Branch dialog the branch popup or a repository's menu asked for. */
export function BranchDialogs(): React.JSX.Element | null {
  const dialog = useSourceControlStore((state) => state.branchDialog)
  if (dialog === null) return null
  if (dialog.kind === 'switch')
    return (
      <SwitchBranchDialog key={`${dialog.group.root}\0${dialog.target.name}`} dialog={dialog} />
    )
  return dialog.kind === 'new' ? (
    <NewBranchDialog key={dialog.group.root} dialog={dialog} />
  ) : (
    <DeleteBranchDialog key={`${dialog.group.root}\0${dialog.name}`} dialog={dialog} />
  )
}
