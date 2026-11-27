/** A generated commit message, or why there is none: a cancel isn't a failure. */
export type CommitMessageOutcome =
  | { ok: true; message: string }
  | { ok: false; output: string; cancelled?: true }

type CommitMessageRequest = {
  /** The working tree whose checked files the message describes. */
  root: string
  /** The checked files, relative to `root`, as Commit takes them. */
  paths: string[]
  /** Describes the last commit with these changes added, as Amend makes it. */
  amend: boolean
}

export const COMMIT_MESSAGE_CHANNELS = {
  generate: 'commit-message:generate',
  cancel: 'commit-message:cancel'
} as const

export type CommitMessageApi = {
  /**
   * Starts the agent, has it write a message for the checked files with the model, effort and
   * instructions from Settings, and stops it.
   */
  generateCommitMessage: (request: CommitMessageRequest) => Promise<CommitMessageOutcome>
  /** Stops this window's running generation; it then resolves cancelled. */
  cancelCommitMessage: () => Promise<void>
}
