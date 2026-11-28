/** A git working tree of a workspace project: the main one or a linked one (`git worktree add`). */
export type Worktree = {
  path: string
  /** The folder's name. */
  name: string
  /** Short branch name, or null when HEAD is detached. */
  branch: string | null
  /** The checked-out commit (empty for a repository without commits). */
  head: string
  /** The project folder itself: the tree shows its branch on the project row instead of a row of its own. */
  project: boolean
  locked: boolean
  /** Git still lists it but its folder is gone (`git worktree prune` would remove it). */
  prunable: boolean
}

/** A git repository and its working trees, or why git can't list them. */
export type RepositoryWorktrees =
  | { folder: string; status: 'git'; worktrees: Worktree[] }
  | { folder: string; status: 'error'; message: string }

/** What git says about a workspace project folder; a multi-repo folder also lists the repositories inside it. */
export type ProjectWorktrees = (RepositoryWorktrees | { folder: string; status: 'not-git' }) & {
  repositories?: RepositoryWorktrees[]
}

export const WORKTREE_CHANNELS = {
  get: 'worktrees:get',
  pruneMissing: 'worktrees:prune-missing',
  changed: 'worktrees:changed'
} as const

export type WorktreeApi = {
  /** Removes only the selected missing registration, preserving branches and other worktrees. */
  pruneMissingWorktrees: (project: string, missingPath: string) => Promise<void>
  /** Every project folder of the open workspace that main has looked at, in workspace order. */
  getWorktrees: () => Promise<ProjectWorktrees[]>
  subscribeWorktrees: (callback: (projects: ProjectWorktrees[]) => void) => () => void
}
