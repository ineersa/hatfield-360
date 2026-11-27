import type { GitOutcome } from './source-control-api'

/** A branch of the working tree's repository, as the branch popup lists it. */
export type LocalBranch = {
  /** Short name (`feature/x`). */
  name: string
  /** Checked out in this working tree. */
  current: boolean
  /** The upstream (`origin/main`), or null when it has none. */
  upstream: string | null
  /** The upstream's branch no longer exists on the remote (after a fetch). */
  upstreamGone: boolean
  /** Commits not yet pushed and not yet pulled; both null without an upstream. */
  ahead: number | null
  behind: number | null
  /** The folder of another working tree that has it checked out, which keeps it from being switched to here; null when none. */
  worktree: string | null
}

export type RemoteBranch = {
  /** Remote and branch (`origin/feature/x`). */
  name: string
  remote: string
  /** The branch's name on the remote (`feature/x`): the local branch it becomes. */
  branch: string
}

export type BranchList = {
  /** The checked-out branch's short name; null when HEAD is detached. */
  current: string | null
  /** The checked-out commit, abbreviated; null before the first commit. */
  head: string | null
  local: LocalBranch[]
  /** Grouped by remote, as `git branch -r` lists them; a remote's HEAD pointer is left out. */
  remote: RemoteBranch[]
}

/** A branch to switch to: a local one, or a remote one through its local tracking branch. */
export type SwitchTarget = { kind: 'local' | 'remote'; name: string }

/** Where a new branch starts: the current commit, or a listed branch. */
export type BranchStart =
  | { kind: 'head' }
  | { kind: 'local'; name: string }
  | { kind: 'remote'; name: string }

type CreateBranchRequest = {
  root: string
  name: string
  start: BranchStart
  /** Switch to it once created. */
  switchTo: boolean
}

/** A commit a deletion would leave on no branch, tag or remote branch. */
export type LostCommit = { hash: string; subject: string }

/**
 * What a deletion did. When git refused because the branch isn't merged, `unmerged` lists the
 * commits no other ref holds (possibly none: merged elsewhere, not into HEAD), so the user can
 * decide on a force delete.
 */
export type BranchDeletion =
  | { ok: true; output: string }
  | {
      ok: false
      output: string
      cancelled?: true
      unmerged?: { commits: LostCommit[]; more: number }
    }

/** What a switch would do to the working tree's local changes, read when the Switch dialog opens. */
export type SwitchPreview = {
  /** The branch checked out: a remote branch's local tracking branch when it has one. */
  branch: string
  /** Files with local changes, untracked ones included. */
  changed: number
  /**
   * Changed files that also differ on the branch, so git refuses the switch (unless a change
   * already matches the branch); the first few, the rest counted in `more`.
   */
  conflicting: string[]
  more: number
}

export const BRANCH_CHANNELS = {
  list: 'branches:list',
  preview: 'branches:preview-switch',
  switch: 'branches:switch',
  create: 'branches:create',
  delete: 'branches:delete'
} as const

export type BranchApi = {
  /** The working tree's local and remote branches, read now. */
  listBranches: (root: string) => Promise<BranchList>
  /** The local changes a switch to the branch would carry, and those git would refuse it over. */
  previewSwitch: (root: string, branch: SwitchTarget) => Promise<SwitchPreview>
  /**
   * `git switch` to a local branch; a remote branch (`kind: 'remote'`) is switched to through a
   * local branch tracking it, created when there is none. Git's refusal (local changes, a branch
   * checked out elsewhere) comes back as `{ ok: false }` with its output; nothing changes then.
   */
  switchBranch: (root: string, branch: SwitchTarget) => Promise<GitOutcome>
  /**
   * Creates a branch at `start`, switching to it when asked. An invalid name, or one a branch
   * already has, is refused (`{ ok: false }`) before git runs.
   */
  createBranch: (request: CreateBranchRequest) => Promise<GitOutcome>
  /**
   * `git branch -d`, or `-D` with `force`. The current branch, and one checked out in another
   * working tree, are refused before git runs.
   */
  deleteBranch: (root: string, name: string, force: boolean) => Promise<BranchDeletion>
}
