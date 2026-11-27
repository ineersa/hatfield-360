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
      /** Untracked files are listed one by one, never as a folder. */
      files: ChangedFile[]
    })
  | (SourceControlGroupBase & { status: 'not-git' })
  | (SourceControlGroupBase & { status: 'error'; message: string })

/**
 * The outcome of a git command run for the user. `output` is everything git (and any hook) printed,
 * stdout and stderr in the order they arrived, unedited: show it as it is.
 */
export type GitOutcome = { ok: true; output: string } | { ok: false; output: string }

type CommitRequest = {
  root: string
  /** Paths (`ChangedFile.path`) committed as they are in the working tree, whatever the index holds. */
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
  launchHunk: 'source-control:launch-hunk'
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
  /** Restores tracked paths to HEAD (both sides of a rename) and deletes untracked ones. */
  rollbackChanges: (root: string, paths: string[]) => Promise<GitOutcome>
  /**
   * `hunk diff --watch HEAD` (review: every change the Commit panel lists, staged or not; the empty
   * tree before the first commit) or `hunk log`, in a terminal driven by the terminal API.
   */
  launchHunk: (request: HunkLaunchRequest) => Promise<HunkLaunch>
}
