import { TriangleAlert, X } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useHunkTabStore } from '@/state/hunk-tab-store'
import { HunkSetupSteps } from './HunkSetupSteps'

const ENTRIES = [
  {
    term: 'Review',
    detail: (
      <>
        Opens <code className="font-mono text-foreground">hunk diff --watch HEAD</code> for a
        repository: the Review button on its row in the Commit panel.
      </>
    )
  },
  {
    term: 'Log',
    detail: (
      <>
        Opens <code className="font-mono text-foreground">hunk log</code>. Select a commit to see
        its changes.
      </>
    )
  },
  {
    term: 'Branch',
    detail: (
      <>
        Review Branch, in a repository's right-click menu, opens{' '}
        <code className="font-mono text-foreground">hunk diff main...HEAD</code>: the branch's
        commits since it left its base.
      </>
    )
  },
  {
    term: 'Pull request',
    detail: (
      <>
        Review Pull Request… lists a GitHub repository's open pull requests through{' '}
        <code className="font-mono text-foreground">gh</code> and opens one with{' '}
        <code className="font-mono text-foreground">hunk gh pr</code>. The current branch's shows as
        #number on its row.
      </>
    )
  },
  {
    term: 'Ask an agent',
    detail: (
      <>
        Open Review and write a note on a line with{' '}
        <kbd className="font-mono text-foreground">c</kbd>. Then ask an agent, in a split pane or an
        agent session, to use the hunk-review skill to read your notes and answer them in place.
      </>
    )
  }
]

/** hunk wasn't found when Review or Log was clicked. */
function HunkMissingNotice(): React.JSX.Element {
  const dismiss = useHunkTabStore((state) => state.dismissMissing)
  return (
    <Alert className="border-warning-border bg-warning-background pr-9">
      <TriangleAlert className="text-warning" aria-hidden />
      <AlertTitle className="type-section-title">hunk isn&apos;t installed</AlertTitle>
      <AlertDescription>
        Install it with one of the commands below, then click Review or Log again.
      </AlertDescription>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={dismiss}
        className="absolute top-2 right-2 flex size-small-icon-button items-center justify-center rounded-button text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </Alert>
  )
}

/** The Git view's main area before a Review or Log tab is open: what hunk does here and how to set it up. */
export function GitMainEmpty(): React.JSX.Element {
  const missing = useHunkTabStore((state) => state.missing)
  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-8">
      <div className="m-auto flex w-full max-w-[65ch] flex-col gap-8">
        {missing ? (
          <HunkMissingNotice />
        ) : (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <h2 className="type-page-title">Review changes with hunk</h2>
              <p className="type-description">
                Diffs, history and agent review of your changes run in hunk, in tabs here.
              </p>
            </div>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[max-content_1fr]">
              {ENTRIES.map((entry) => (
                <div key={entry.term} className="contents">
                  <dt className="type-section-title">{entry.term}</dt>
                  <dd className="type-description mb-2 sm:mb-0">{entry.detail}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        <HunkSetupSteps />
      </div>
    </div>
  )
}
