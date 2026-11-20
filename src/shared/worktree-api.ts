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

/** What git says about a workspace project folder. */
export type ProjectWorktrees =
  | { folder: string; status: 'git'; worktrees: Worktree[] }
  | { folder: string; status: 'not-git' }
  | { folder: string; status: 'error'; message: string }

export const WORKTREE_CHANNELS = {
  get: 'worktrees:get',
  changed: 'worktrees:changed'
} as const

export type WorktreeApi = {
  /** Every project folder of the open workspace that main has looked at, in workspace order. */
  getWorktrees: () => Promise<ProjectWorktrees[]>
  subscribeWorktrees: (callback: (projects: ProjectWorktrees[]) => void) => () => void
}
