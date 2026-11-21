import { lstat, realpath } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { GitError, runGit } from './git-command'

/** Whether `folder` is the top of a git working tree: a repository or a linked worktree, not a folder inside one. */
export async function isRepositoryRoot(folder: string): Promise<boolean> {
  try {
    const [top, resolved] = await Promise.all([
      runGit(folder, ['rev-parse', '--show-toplevel']),
      realpath(folder)
    ])
    // `relative` ignores slash style and, on Windows, case: git prints `C:/x` for `c:\x`.
    return relative(top.trim(), resolved) === ''
  } catch (error) {
    // Without git, a `.git` entry is the best sign of a repository.
    if (error instanceof GitError && error.reason === 'no-git') {
      return lstat(join(folder, '.git')).then(
        () => true,
        () => false
      )
    }
    return false
  }
}
