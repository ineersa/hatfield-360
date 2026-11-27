import { devNull } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { type FileStatusResult, simpleGit } from 'simple-git'
import type {
  ChangedFile,
  ChangeKind,
  GitOutcome,
  SourceControlGroup
} from '../../shared/source-control-api'
import { isPathInside } from '../files/path-containment'

type WorkingTreeStatus = Pick<
  Extract<SourceControlGroup, { status: 'git' }>,
  'branch' | 'upstream' | 'ahead' | 'behind' | 'files'
>

/** Keeps a request's command line well under every platform's argument limit. */
const MAX_PATHS = 5000
const MAX_PATH_LENGTH = 4096
const MAX_MESSAGE_LENGTH = 1_000_000

type GitRun = { exitCode: number; stdout: string; output: string }

/**
 * Runs git (no shell) in `root` with the user's own environment. Never rejects for git's exit
 * status: `output` holds stdout and stderr as they arrived, which is what hooks print to.
 */
async function run(root: string, args: string[], input?: string): Promise<GitRun> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    // Nobody can answer a prompt: fail instead of waiting for credentials or a merge message.
    GIT_TERMINAL_PROMPT: '0',
    GIT_MERGE_AUTOEDIT: 'no'
  }
  const chunks: Buffer[] = []
  const collect = (chunk: string | Buffer): void => {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  let exitCode = 0
  let failure = ''
  try {
    const stdout = await simpleGit({
      baseDir: root,
      // simple-git drops inherited GIT_* variables unless named; the user's own (GIT_SSH_COMMAND, ...) must reach git and its hooks.
      allowEnvironment: Object.keys(env),
      errors: (error, result) => {
        exitCode = result.exitCode
        if (error instanceof Error) failure = error.message
        return undefined
      },
      ...(input === undefined ? {} : { input: () => input })
    })
      .env(env)
      .outputHandler((_command, out, err) => {
        out.on('data', collect)
        err.on('data', collect)
      })
      .raw(args)
    const output = Buffer.concat(chunks).toString('utf8')
    return { exitCode, stdout, output: exitCode !== 0 && output === '' ? failure : output }
  } catch (error) {
    return {
      exitCode: -1,
      stdout: '',
      output: error instanceof Error ? error.message : String(error)
    }
  }
}

async function runOrThrow(root: string, args: string[]): Promise<string> {
  const result = await run(root, args)
  if (result.exitCode !== 0) throw new Error(result.output.trim() || `git ${args[0]} failed`)
  return result.stdout
}

const outcome = (result: GitRun): GitOutcome => ({
  ok: result.exitCode === 0,
  output: result.output
})

/** A path git takes as it is: no glob, no `:(magic)`. */
const literal = (path: string): string => `:(literal)${path}`

function changeKind(file: FileStatusResult, conflicted: Set<string>): ChangeKind {
  if (conflicted.has(file.path)) return 'conflicted'
  const codes = `${file.index}${file.working_dir}`
  if (codes === '??') return 'untracked'
  if (codes.includes('R')) return 'renamed'
  if (file.index === 'A' || file.index === 'C') return 'added'
  if (codes.includes('D')) return 'deleted'
  return 'modified'
}

/** The branch, its upstream and every changed file of the working tree at `root`. */
export async function readWorkingTreeStatus(root: string): Promise<WorkingTreeStatus> {
  let status
  try {
    status = await simpleGit({
      baseDir: root,
      allowEnvironment: [...Object.keys(process.env), 'GIT_OPTIONAL_LOCKS']
    })
      // Reading status must not take the index lock the user's own git commands need.
      .env({ ...process.env, GIT_OPTIONAL_LOCKS: '0' })
      .status()
  } catch (error) {
    throw new Error((error instanceof Error ? error.message : String(error)).trim(), {
      cause: error
    })
  }
  const conflicted = new Set(status.conflicted)
  const files = status.files.map((file): ChangedFile => ({
    path: file.path,
    absolutePath: join(root, file.path),
    originalPath: file.from ?? null,
    kind: changeKind(file, conflicted)
  }))
  const tracked = status.tracking !== null
  return {
    branch: status.detached ? null : status.current,
    upstream: status.tracking,
    ahead: tracked ? status.ahead : null,
    behind: tracked ? status.behind : null,
    files
  }
}

/**
 * The request's paths relative to `root` with `/` separators, refusing any that isn't a string
 * naming something inside it.
 */
function repositoryPaths(root: string, paths: unknown): string[] {
  if (!Array.isArray(paths) || paths.length > MAX_PATHS) throw new Error('Invalid file list.')
  return paths.map((path: unknown) => {
    if (
      typeof path !== 'string' ||
      path === '' ||
      path.length > MAX_PATH_LENGTH ||
      path.includes('\0') ||
      isAbsolute(path)
    )
      throw new Error('Invalid file path.')
    const target = resolve(root, path)
    if (target === resolve(root) || !isPathInside(target, root))
      throw new Error(`${path} is outside the repository.`)
    return relative(root, target).split(sep).join('/')
  })
}

/** The requested files' status entries; paths with no changes have none. */
async function changedFiles(root: string, paths: string[]): Promise<ChangedFile[]> {
  const wanted = new Set(paths)
  const { files } = await readWorkingTreeStatus(root)
  return files.filter((file) => wanted.has(file.path))
}

/** A path and, for a rename, where it came from: the two halves of one change. */
const bothSides = (file: ChangedFile): string[] =>
  file.originalPath === null ? [file.path] : [file.path, file.originalPath]

/** What the Commit panel's changes are relative to: HEAD, or the empty tree before the first commit. */
export async function diffBase(root: string): Promise<string> {
  const head = await run(root, ['rev-parse', '--verify', '-q', 'HEAD'])
  return head.exitCode === 0
    ? 'HEAD'
    : (await runOrThrow(root, ['hash-object', '-t', 'tree', devNull])).trim()
}

/**
 * Commits the paths as they are in the working tree, leaving every other change (staged or not)
 * where it was. New files are added first and taken out of the index again if the commit fails.
 */
export async function commitChanges(
  root: string,
  request: { paths: unknown; message: unknown; amend: boolean }
): Promise<GitOutcome> {
  if (typeof request.message !== 'string' || request.message.length > MAX_MESSAGE_LENGTH)
    throw new Error('Invalid commit message.')
  const paths = repositoryPaths(root, request.paths)
  // An empty message would leave git waiting on stdin: nothing is written to it.
  if (request.message.trim() === '') return { ok: false, output: 'Write a commit message.' }
  if (paths.length === 0 && !request.amend)
    return { ok: false, output: 'Choose the files to commit.' }
  const files = paths.length === 0 ? [] : await changedFiles(root, paths)
  const untracked = files.filter((file) => file.kind === 'untracked').map((file) => file.path)
  // Paths with no changes stay in: git's pathspec check speaks for them.
  const known = new Set(files.flatMap(bothSides))
  const pathspecs = [...new Set([...known, ...paths])].map(literal)
  if (untracked.length > 0) {
    const added = await run(root, ['add', '--', ...untracked.map(literal)])
    if (added.exitCode !== 0) return outcome(added)
  }
  const committed = await run(
    root,
    [
      'commit',
      '--only',
      ...(request.amend ? ['--amend'] : []),
      '--file=-',
      ...(pathspecs.length > 0 ? ['--', ...pathspecs] : [])
    ],
    request.message
  )
  if (committed.exitCode !== 0 && untracked.length > 0)
    await run(root, ['rm', '--cached', '-q', '-f', '--', ...untracked.map(literal)])
  return outcome(committed)
}

/** The last commit's message as written, or null on a branch without commits. */
export async function lastCommitMessage(root: string): Promise<string | null> {
  const head = await run(root, ['rev-parse', '--verify', '-q', 'HEAD'])
  if (head.exitCode !== 0) return null
  const message = await runOrThrow(root, [
    'log',
    '-1',
    '--no-show-signature',
    '--format=%B',
    'HEAD'
  ])
  return message.replace(/\n+$/, '')
}

/** Where a branch without an upstream goes: the push default, else `origin`, else the only remote. */
async function pushRemote(root: string): Promise<string | null> {
  const configured = await run(root, ['config', '--get', 'remote.pushDefault'])
  if (configured.exitCode === 0 && configured.stdout.trim()) return configured.stdout.trim()
  const remotes = (await runOrThrow(root, ['remote'])).split('\n').filter(Boolean)
  if (remotes.includes('origin')) return 'origin'
  return remotes.length === 1 ? (remotes[0] ?? null) : null
}

/**
 * Pushes the current branch; one without an upstream gets one on the remote it is pushed to. Git
 * itself explains a detached HEAD or a repository without remotes.
 */
export async function pushBranch(root: string): Promise<GitOutcome> {
  const upstream = await run(root, [
    'rev-parse',
    '--abbrev-ref',
    '--symbolic-full-name',
    '@{upstream}'
  ])
  const branch = await run(root, ['symbolic-ref', '-q', 'HEAD'])
  const remote = upstream.exitCode !== 0 && branch.exitCode === 0 ? await pushRemote(root) : null
  return outcome(await run(root, remote ? ['push', '--set-upstream', remote, 'HEAD'] : ['push']))
}

export async function pullBranch(root: string): Promise<GitOutcome> {
  return outcome(await run(root, ['pull']))
}

/**
 * Returns the paths to HEAD: untracked files are deleted, tracked ones restored in the index and
 * the working tree (a staged new file goes away, a deleted one comes back, a rename is undone on
 * both sides). Paths without changes are left alone.
 */
export async function rollbackChanges(root: string, requested: unknown): Promise<GitOutcome> {
  const files = await changedFiles(root, repositoryPaths(root, requested))
  const untracked = files.filter((file) => file.kind === 'untracked').map((file) => file.path)
  const tracked = files.filter((file) => file.kind !== 'untracked').flatMap(bothSides)
  let output = ''
  if (tracked.length > 0) {
    const head = await run(root, ['rev-parse', '--verify', '-q', 'HEAD'])
    // Without a commit every tracked change is a staged new file: HEAD has none of them.
    const restored = await run(
      root,
      head.exitCode === 0
        ? ['restore', '--source=HEAD', '--staged', '--worktree', '--', ...tracked.map(literal)]
        : ['rm', '-q', '-f', '--', ...tracked.map(literal)]
    )
    if (restored.exitCode !== 0) return outcome(restored)
    output += restored.output
  }
  if (untracked.length > 0) {
    const cleaned = await run(root, ['clean', '-f', '-q', '--', ...untracked.map(literal)])
    if (cleaned.exitCode !== 0) return { ok: false, output: output + cleaned.output }
    output += cleaned.output
  }
  return { ok: true, output }
}
