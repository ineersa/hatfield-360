import type { TerminalSession } from './terminal-api'

/** How a file differs from HEAD, as the commit panel shows it. */
export type ChangeKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'

export type ChangedFile = {
  /** Relative to the group's `root`, with `/` separators, as git prints it: what commit and rollback take. */
  path: string
  /** `path` joined to the group's `root`, for opening the file in the editor. */
  absolutePath: string
  /** Where a renamed file came from (relative to `root`); null for every other kind. */
  originalPath: string | null
  kind: ChangeKind
  /**
   * An untracked nested repository or linked worktree inside the root, which git lists as one
   * folder (`path` without git's trailing slash): it can be ignored or deleted, not added.
   */
  nestedRepository: boolean
}

/** What git is in the middle of: a commit then concludes a merge, cherry-pick or revert; a rebase is finished in a terminal. */
export type GitOperation = 'merge' | 'cherry-pick' | 'revert' | 'rebase'

/** A merge, cherry-pick, revert or rebase waiting to be concluded or aborted. */
export type GitOperationState = {
  kind: GitOperation
  /** A merge's branch (`origin/main`) when exactly one branch points at what is merged; else null. */
  merging: string | null
  /** The message git prepared for concluding it (MERGE_MSG without its comments); null for a rebase or when git wrote none. */
  message: string | null
  /** Conflicted files still holding conflict markers: what the commit waits for. */
  conflicts: number
}

type SourceControlGroupBase = {
  /** The workspace project folder the group belongs to. */
  project: string
  /** The working tree's top folder: what every request names. The project folder itself when it isn't usable git. */
  root: string
  /** The root folder's name. */
  name: string
  /** A linked worktree (`git worktree add`) or another working tree of the project's repository, not the project folder. */
  worktree: boolean
}

/** One repository or worktree of the open workspace and its uncommitted changes. */
export type SourceControlGroup =
  | (SourceControlGroupBase & {
      status: 'git'
      /** Short branch name; null when HEAD is detached. A repository without commits has its branch here too. */
      branch: string | null
      /** The upstream (`origin/main`), or null when the branch has none. */
      upstream: string | null
      /** Commits not yet pushed and not yet pulled; both null without an upstream. */
      ahead: number | null
      behind: number | null
      /** A merge, cherry-pick, revert or rebase waiting to be concluded; null when none is. */
      operation: GitOperationState | null
      /** Untracked files are listed one by one; only a nested repository is listed as a folder. */
      files: ChangedFile[]
    })
  | (SourceControlGroupBase & { status: 'not-git' })
  | (SourceControlGroupBase & { status: 'error'; message: string })

/**
 * The outcome of a git command run for the user. `output` is everything git (and any hook) printed,
 * stdout and stderr in the order they arrived, unedited: show it as it is.
 */
export type GitOutcome =
  | { ok: true; output: string }
  /** `cancelled`: stopped by `cancelSourceControlAction`, along with everything git had started. */
  | { ok: false; output: string; cancelled?: true }

type CommitRequest = {
  root: string
  /**
   * Paths (`ChangedFile.path`) committed as they are in the working tree, whatever the index holds.
   * An untracked path is refused (`{ ok: false }`) until it is added to version control. During a
   * merge, cherry-pick or revert they are staged and the whole index is committed, concluding it;
   * during a rebase the commit is refused.
   */
  paths: string[]
  message: string
  /** Replaces the last commit: with no paths only its message changes. */
  amend: boolean
}

/**
 * `review`: uncommitted changes; `log`: history; `stash`: one stash; `branch`: the current branch's
 * commits on top of a base; `pull-request`: a GitHub pull request.
 */
export type HunkKind = 'review' | 'log' | 'stash' | 'branch' | 'pull-request'

type HunkLaunchRequest = {
  root: string
  kind: HunkKind
  /**
   * What `stash`, `branch` and `pull-request` show: the stash's commit (`StashEntry.id`), the base
   * branch, or the pull request's number.
   */
  target?: string
  cols: number
  rows: number
}

/** A terminal running hunk in the root, or `missing` when no `hunk` is on the user's shell PATH. */
export type HunkLaunch = { status: 'started'; terminal: TerminalSession } | { status: 'missing' }

/** A pull request tab's GitHub discussion, as loaded into its hunk. */
export type PullRequestComments =
  | {
      status: 'loaded'
      /** Unresolved review threads shown on their lines. */
      threads: number
      /** Comments on the pull request itself, shown on the first hunk. */
      conversation: number
      /** Unresolved threads and comments hunk has no place for: outdated, or off the diff. */
      notShown: number
    }
  | { status: 'failed'; message: string }

export type PullRequestPublish =
  | {
      status: 'published'
      /** Comments posted: a review's new threads count one each. */
      posted: number
      /** The user's notes that couldn't be posted: not on a line. */
      unplaced: number
      comments: PullRequestComments
    }
  | { status: 'nothing'; unplaced: number }
  /** Some or all posts failed; `posted` went through and are out of hunk. */
  | { status: 'failed'; message: string; posted: number; comments: PullRequestComments | null }

export const SOURCE_CONTROL_CHANNELS = {
  status: 'source-control:status',
  commit: 'source-control:commit',
  lastCommitMessage: 'source-control:last-commit-message',
  push: 'source-control:push',
  pull: 'source-control:pull',
  rollback: 'source-control:rollback',
  fetch: 'source-control:fetch',
  addUntracked: 'source-control:add-untracked',
  ignoreUntracked: 'source-control:ignore-untracked',
  abortOperation: 'source-control:abort-operation',
  launchHunk: 'source-control:launch-hunk',
  hunkNoteCount: 'source-control:hunk-note-count',
  loadPullRequestComments: 'source-control:load-pull-request-comments',
  publishPullRequestNotes: 'source-control:publish-pull-request-notes',
  cancel: 'source-control:cancel'
} as const

export type SourceControlApi = {
  /** Every git project and worktree of the open workspace, in workspace order, read now. */
  getSourceControlStatus: () => Promise<SourceControlGroup[]>
  /** Hooks run; a failing hook or commit comes back as `{ ok: false }` with git's output. */
  commitChanges: (request: CommitRequest) => Promise<GitOutcome>
  /** The last commit's full message, or null when the branch has no commits yet. */
  getLastCommitMessage: (root: string) => Promise<string | null>
  /** Pushes the current branch, setting its upstream on the remote when it has none. */
  pushBranch: (root: string) => Promise<GitOutcome>
  pullBranch: (root: string) => Promise<GitOutcome>
  /**
   * Restores paths to HEAD (both sides of a rename; a file added since is deleted). An untracked
   * path is refused: HEAD has nothing to return it to.
   */
  rollbackChanges: (root: string, paths: string[]) => Promise<GitOutcome>
  /** `git fetch` in the root, so its ahead/behind counts catch up with the remote. */
  fetchRemote: (root: string) => Promise<GitOutcome>
  /**
   * `git add` for untracked files (`ChangedFile.path`); any other path, or a nested repository, is
   * refused before git runs.
   */
  addUntrackedFiles: (root: string, paths: string[]) => Promise<GitOutcome>
  /**
   * Appends a pattern matching exactly this untracked file (a nested repository as a folder) to the
   * root's .gitignore, creating it if missing; any other path is refused.
   */
  ignoreUntrackedFile: (root: string, path: string) => Promise<void>
  /**
   * `git <operation> --abort` in the root: a merge, cherry-pick or revert puts back the files it
   * changed, a rebase returns the branch and working tree to where they were. Refused before git
   * runs when nothing is in progress or another operation than `operation` is.
   */
  abortGitOperation: (root: string, operation: GitOperation) => Promise<GitOutcome>
  /**
   * Stops the commit, push, pull, fetch, rollback, add, abort or branch action this window is running, with its hooks and
   * ssh; that call resolves `{ ok: false, cancelled: true }`. Nothing running: nothing happens.
   */
  cancelSourceControlAction: () => Promise<void>
  /**
   * `hunk diff --watch HEAD` (review: every change the Commit panel lists, staged or not; the empty
   * tree before the first commit), `hunk log` or `hunk stash show` for one stash, in a terminal
   * driven by the terminal API.
   */
  launchHunk: (request: HunkLaunchRequest) => Promise<HunkLaunch>
  /** How many review notes the hunk in that terminal holds: hunk keeps them only while it runs. */
  hunkNoteCount: (terminalId: string) => Promise<number>
  /**
   * Loads a pull request tab's unresolved GitHub threads and comments into its hunk, in place of
   * those loaded before; waits for hunk to start.
   */
  loadPullRequestComments: (terminalId: string) => Promise<PullRequestComments>
  /** Posts a pull request tab's notes typed in hunk to GitHub, as the signed-in gh user. */
  publishPullRequestNotes: (terminalId: string) => Promise<PullRequestPublish>
}
