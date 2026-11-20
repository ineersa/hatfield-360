import { execFile } from 'node:child_process'

/** Why git couldn't answer: not a repository, git missing, or git's own error. */
export class GitError extends Error {
  constructor(
    message: string,
    readonly reason: 'not-git' | 'no-git' | 'failed'
  ) {
    super(message)
  }
}

const OUTPUT_LIMIT = 16 * 1024 * 1024

/** Runs git (no shell) in `cwd` and resolves with its stdout. */
export function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd,
        encoding: 'utf8',
        maxBuffer: OUTPUT_LIMIT,
        windowsHide: true,
        // Reading the list must not take locks that would race the user's own git commands.
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' }
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve(stdout)
          return
        }
        if ('code' in error && error.code === 'ENOENT') {
          reject(new GitError('Git is not installed or not on the PATH', 'no-git'))
          return
        }
        const detail = stderr.trim().split(/\r?\n/)[0] ?? ''
        reject(
          new GitError(
            detail.replace(/^fatal: /, '') || error.message,
            /not a git repository/i.test(stderr) ? 'not-git' : 'failed'
          )
        )
      }
    )
  })
}
