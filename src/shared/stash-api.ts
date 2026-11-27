import type { GitOutcome } from './source-control-api'

/** One stash of a repository. */
export type StashEntry = {
  /** The stash's commit: what every request names, since `stash@{n}` shifts as stashes come and go. */
  id: string
  /** The branch it was made on; null when HEAD was detached. */
  branch: string | null
  /** Its message, or git's `1a2b3c4 subject` for one stashed without a message. */
  message: string
  /** When it was made, in milliseconds since the epoch. */
  createdAt: number
}

type StashRequest = {
  root: string
  /** Tracked changes (`ChangedFile.path`), stashed with both sides of a rename; an untracked one is refused. */
  paths: string[]
  /** Untracked files to stash with them; a nested repository is refused. */
  untracked: string[]
  /** Empty: git names it after the last commit. */
  message: string
}

export const STASH_CHANNELS = {
  list: 'stash:list',
  push: 'stash:push',
  apply: 'stash:apply',
  drop: 'stash:drop'
} as const

export type StashApi = {
  /** The repository's stashes, newest first. */
  listStashes: (root: string) => Promise<StashEntry[]>
  /**
   * Puts the chosen files' changes in a new stash, leaving every other change where it was.
   * Cancellable like any git action of the Commit panel.
   */
  stashChanges: (request: StashRequest) => Promise<GitOutcome>
  /**
   * Applies the stash to the working tree; `pop` drops it once applied. A conflict comes back as
   * `{ ok: false }` with git's output and keeps the stash.
   */
  unstash: (root: string, id: string, pop: boolean) => Promise<GitOutcome>
  /** Deletes the stash. */
  dropStash: (root: string, id: string) => Promise<GitOutcome>
}
