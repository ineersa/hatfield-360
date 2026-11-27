import { execFile, spawn } from 'node:child_process'

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

type GitOptions = {
  /** Written to git's stdin. */
  input?: string
  /** Exit codes that are answers rather than failures, such as 1 from `check-ignore` when nothing matched. */
  okExitCodes?: number[]
}

/** Runs git (no shell) in `cwd` and resolves with its stdout. */
export function runGit(cwd: string, args: string[], options: GitOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
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
        if (
          !error ||
          (typeof error.code === 'number' && options.okExitCodes?.includes(error.code))
        ) {
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
    if (options.input !== undefined) {
      // Git exiting before it reads all the input breaks the pipe; its exit status says why.
      child.stdin?.on('error', (error) => {
        if (!('code' in error && error.code === 'EPIPE')) reject(error)
      })
      child.stdin?.end(options.input)
    }
  })
}

/** A git command run for the user: its exit code, its stdout, and everything it and its hooks printed. */
export type GitRun = {
  /** Git's exit status; -1 when it couldn't start, was cancelled or printed too much. */
  exitCode: number
  stdout: string
  /** Stdout and stderr interleaved as they arrived, unedited: hooks print to either. */
  output: string
  /** Stopped through `signal`. */
  cancelled: boolean
}

type GitRunOptions = {
  /** Written to stdin; without it stdin is closed (`/dev/null`). */
  input?: string | undefined
  /**
   * Output the app reads rather than shows (status, rev-parse): C locale, and no optional locks
   * that would race the user's own git commands. Without it, git speaks the user's language.
   */
  parsed?: boolean
  /** Stops git and everything it started (hooks, ssh): the whole process group. */
  signal?: AbortSignal | undefined
}

/**
 * The user's environment, untouched otherwise (GIT_SSH_COMMAND, askpass, config paths), with
 * nobody to answer a prompt and no editor to wait for.
 */
function userGitEnvironment(parsed: boolean): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_MERGE_AUTOEDIT: 'no',
    // `true` exits at once, accepting the message or todo list git prepared.
    GIT_EDITOR: 'true',
    GIT_SEQUENCE_EDITOR: 'true',
    ...(parsed ? { GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' } : {})
  }
}

/**
 * Runs git (no shell) in `cwd` for the user. Never rejects: a failure is in `exitCode` and
 * `output`. Git starts in a session of its own (POSIX `setsid`): with no controlling terminal,
 * ssh and hooks reading /dev/tty fail instead of prompting, and the process group can be stopped.
 */
export function runGitWithOutput(
  cwd: string,
  args: string[],
  options: GitRunOptions = {}
): Promise<GitRun> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    const stdout: Buffer[] = []
    let size = 0
    let problem: string | null = null
    let cancelled = false
    const child = spawn('git', args, {
      cwd,
      env: userGitEnvironment(options.parsed ?? false),
      stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      detached: true
    })
    const stop = (): void => {
      if (child.pid === undefined || child.exitCode !== null) return
      try {
        // The negative pid names the group: git, its hooks and ssh.
        process.kill(-child.pid, 'SIGTERM')
      } catch {
        // Already gone.
      }
    }
    const onAbort = (): void => {
      cancelled = true
      stop()
    }
    const collect =
      (into: Buffer[] | null) =>
      (chunk: Buffer): void => {
        size += chunk.length
        if (size > OUTPUT_LIMIT) {
          problem ??= 'Git printed more than 16 MB: run the command in a terminal.'
          stop()
          return
        }
        chunks.push(chunk)
        into?.push(chunk)
      }
    child.stdout?.on('data', collect(stdout))
    child.stderr?.on('data', collect(null))
    child.on('error', (error: NodeJS.ErrnoException) => {
      problem ??=
        error.code === 'ENOENT' ? 'Git is not installed or not on the PATH' : error.message
    })
    child.on('close', (code) => {
      options.signal?.removeEventListener('abort', onAbort)
      const output = Buffer.concat(chunks).toString('utf8')
      resolve({
        exitCode: problem !== null || cancelled || code === null ? -1 : code,
        stdout: Buffer.concat(stdout).toString('utf8'),
        output: problem ?? output,
        cancelled
      })
    })
    if (options.signal?.aborted) onAbort()
    else options.signal?.addEventListener('abort', onAbort, { once: true })
    if (options.input !== undefined) {
      // Git exiting before it reads all the input breaks the pipe; its exit status says why.
      child.stdin?.on('error', () => {})
      child.stdin?.end(options.input)
    }
  })
}
