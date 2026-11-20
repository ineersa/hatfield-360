// Ported from Orca's git-worktree-porcelain-parser.ts (MIT, see THIRD_PARTY_NOTICES.md).

/** One record of `git worktree list --porcelain -z`. */
export type ListedWorktree = {
  path: string
  head: string
  /** Full ref (`refs/heads/main`), or null when detached. */
  branch: string | null
  bare: boolean
  locked: boolean
  prunable: boolean
}

/** Attributes end with NUL and records with an extra NUL, so paths need no unquoting. */
function records(output: string): string[][] {
  const blocks: string[][] = []
  let current: string[] = []
  for (const field of output.split('\0')) {
    if (field) {
      current.push(field)
    } else if (current.length > 0) {
      blocks.push(current)
      current = []
    }
  }
  if (current.length > 0) blocks.push(current)
  return blocks
}

/** Parses `git worktree list --porcelain -z`; git always lists the main working tree first. */
export function parseWorktreeList(output: string): ListedWorktree[] {
  const worktrees: ListedWorktree[] = []
  for (const fields of records(output)) {
    const worktree: ListedWorktree = {
      path: '',
      head: '',
      branch: null,
      bare: false,
      locked: false,
      prunable: false
    }
    for (const field of fields) {
      if (field.startsWith('worktree ')) worktree.path = field.slice('worktree '.length)
      else if (field.startsWith('HEAD ')) worktree.head = field.slice('HEAD '.length)
      else if (field.startsWith('branch ')) worktree.branch = field.slice('branch '.length)
      else if (field === 'bare') worktree.bare = true
      else if (field === 'locked' || field.startsWith('locked ')) worktree.locked = true
      else if (field === 'prunable' || field.startsWith('prunable ')) worktree.prunable = true
    }
    if (worktree.path) worktrees.push(worktree)
  }
  return worktrees
}

/** `refs/heads/feature/x` → `feature/x`. */
export function shortBranchName(ref: string): string {
  return ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref
}
