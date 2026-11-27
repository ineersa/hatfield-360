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
      operation: GitOperation | null
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

export type HunkKind = 'review' | 'log'

type HunkLaunchRequest = { root: string; kind: HunkKind; cols: number; rows: number }

/** A terminal running hunk in the root, or `missing` when no `hunk` is on the user's shell PATH. */
export type HunkLaunch = { status: 'started'; terminal: TerminalSession } | { status: 'missing' }

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
  launchHunk: 'source-control:launch-hunk',
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
   * Stops the commit, push, pull, fetch, rollback or add this window is running, with its hooks and
   * ssh; that call resolves `{ ok: false, cancelled: true }`. Nothing running: nothing happens.
   */
  cancelSourceControlAction: () => Promise<void>
  /**
   * `hunk diff --watch HEAD` (review: every change the Commit panel lists, staged or not; the empty
   * tree before the first commit) or `hunk log`, in a terminal driven by the terminal API.
   */
  launchHunk: (request: HunkLaunchRequest) => Promise<HunkLaunch>
}
