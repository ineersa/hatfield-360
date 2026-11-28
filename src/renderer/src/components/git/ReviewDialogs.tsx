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
import { type ReviewDialog, useReviewStore } from '@/state/review-store'
import type { PullRequestList } from '../../../../shared/review-api'
import { type Choice, ChoiceList } from './ChoiceList'

function Reading({ what }: { what: string }): React.JSX.Element {
  return (
    <p className="type-body flex items-center gap-2">
      <Spinner className="size-4" aria-hidden />
      {`Reading the ${what}…`}
    </p>
  )
}

/** Chooses the branch to review the current one against: its commits since leaving that branch. */
function BaseBranchDialog({
  dialog
}: {
  dialog: Extract<ReviewDialog, { kind: 'base' }>
}): React.JSX.Element {
  const close = useReviewStore((state) => state.close)
  const reviewBranch = useReviewStore((state) => state.reviewBranch)
  const defaultBase = useReviewStore((state) => state.reviews[dialog.group.root]?.base ?? null)
  const [filter, setFilter] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const labelId = useId()
  const { group, branches, problem } = dialog
  const current = branches?.current ?? group.branch
  const choices: Choice[] = branches
    ? [
        ...branches.local
          .filter((branch) => branch.name !== current)
          .map((branch) => ({ id: branch.name, label: branch.name, hint: 'local' })),
        ...branches.remote.map((branch) => ({
          id: branch.name,
          label: branch.name,
          hint: branch.remote
        }))
      ].filter((choice) => choice.id.toLowerCase().includes(filter.trim().toLowerCase()))
    : []
  const chosen =
    choices.find((choice) => choice.id === (picked ?? defaultBase))?.id ?? choices[0]?.id ?? null
  const submit = (): void => {
    if (chosen !== null) reviewBranch(group, chosen)
  }
  return (
    <AlertDialog open onOpenChange={(open) => !open && close()}>
      <AlertDialogContent>
        <AlertDialogTitle id={labelId}>{`Review ${current ?? 'HEAD'} Against…`}</AlertDialogTitle>
        {branches === null ? (
          <Reading what="branches" />
        ) : problem === null ? (
          <>
            <Input
              aria-label="Filter branches"
              autoFocus
              placeholder="Filter branches"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                submit()
              }}
            />
            {choices.length === 0 ? (
              <AlertDialogDescription>No branch matches.</AlertDialogDescription>
            ) : (
              <ChoiceList
                labelledBy={labelId}
                name="base"
                choices={choices}
                chosen={chosen}
                onChoose={setPicked}
              />
            )}
            <AlertDialogDescription>
              {`Shows the commits of ${current ?? 'HEAD'} since it left the chosen branch, not what that branch got since.`}
            </AlertDialogDescription>
          </>
        ) : (
          <p role="alert" className="type-body text-error">
            {`Couldn't read the branches: ${problem}`}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction primary disabled={chosen === null} onClick={submit}>
            Review
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Why there's no list, and what to do about it. */
function PullRequestsUnavailable({
  list
}: {
  list: Exclude<PullRequestList, { status: 'listed' }>
}): React.JSX.Element {
  if (list.status === 'no-gh')
    return (
      <AlertDialogDescription>
        Listing pull requests needs the GitHub CLI, <code>gh</code>, on your shell’s PATH. Install
        it from cli.github.com, run <code>gh auth login</code>, then try again.
      </AlertDialogDescription>
    )
  return list.status === 'signed-out' ? (
    <AlertDialogDescription>
      {`gh isn't signed in to ${list.host}. Run `}
      <code>gh auth login</code>
      {' in a terminal, then try again.'}
    </AlertDialogDescription>
  ) : (
    <p role="alert" className="type-body whitespace-pre-wrap text-error">
      {`Couldn't list the pull requests: ${list.output}`}
    </p>
  )
}

/** The repository's open pull requests, one chosen to review in a hunk tab. */
function PullRequestsDialog({
  dialog
}: {
  dialog: Extract<ReviewDialog, { kind: 'pull-requests' }>
}): React.JSX.Element {
  const close = useReviewStore((state) => state.close)
  const reviewPullRequest = useReviewStore((state) => state.reviewPullRequest)
  const own = useReviewStore((state) => state.reviews[dialog.group.root]?.pullRequest ?? null)
  const [picked, setPicked] = useState<string | null>(null)
  const labelId = useId()
  const { group, list } = dialog
  const pullRequests = list?.status === 'listed' ? list.pullRequests : []
  const chosen =
    pullRequests.find((each) => String(each.number) === (picked ?? String(own?.number))) ??
    pullRequests[0]
  return (
    <AlertDialog open onOpenChange={(open) => !open && close()}>
      <AlertDialogContent>
        <AlertDialogTitle id={labelId}>{`Pull Requests · ${group.name}`}</AlertDialogTitle>
        {list === null ? (
          <Reading what="pull requests" />
        ) : list.status !== 'listed' ? (
          <PullRequestsUnavailable list={list} />
        ) : pullRequests.length === 0 ? (
          <AlertDialogDescription>{`${group.name} has no open pull requests.`}</AlertDialogDescription>
        ) : (
          <>
            <ChoiceList
              labelledBy={labelId}
              name="pull-request"
              choices={pullRequests.map((each) => ({
                id: String(each.number),
                label: `#${each.number} ${each.title}`,
                hint: [
                  each.draft ? 'draft' : null,
                  each.number === own?.number ? 'this branch' : each.branch,
                  each.author
                ]
                  .filter((part) => part !== null)
                  .join(' · ')
              }))}
              chosen={chosen ? String(chosen.number) : null}
              onChoose={setPicked}
            />
            <AlertDialogDescription>
              hunk fetches the pull request’s changes from GitHub; nothing changes here.
            </AlertDialogDescription>
          </>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{chosen ? 'Cancel' : 'Close'}</AlertDialogCancel>
          {chosen ? (
            <AlertDialogAction primary onClick={() => reviewPullRequest(group, chosen)}>
              Review
            </AlertDialogAction>
          ) : null}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** The base chooser or pull request list the Commit panel asked for. */
export function ReviewDialogs(): React.JSX.Element | null {
  const dialog = useReviewStore((state) => state.dialog)
  if (dialog === null) return null
  return dialog.kind === 'base' ? (
    <BaseBranchDialog key={dialog.group.root} dialog={dialog} />
  ) : (
    <PullRequestsDialog key={dialog.group.root} dialog={dialog} />
  )
}
