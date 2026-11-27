import { access, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { devNull, tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type {
  ChangedFile,
  GitOperation,
  GitOutcome,
  SourceControlGroup
} from '../../shared/source-control-api'
import { writeFileAtomic } from '../files/atomic-write'
import { isPathInside } from '../files/path-containment'
import { type GitRun, runGitWithOutput } from './git-command'
import { anchoredIgnorePattern } from './git-ignore'
import { parseStatus, STATUS_ARGS } from './status-porcelain'

type WorkingTreeStatus = Pick<
  Extract<SourceControlGroup, { status: 'git' }>,
  'branch' | 'upstream' | 'ahead' | 'behind' | 'operation' | 'files'
>

/** Far above any real selection; git reads paths from stdin, so only the request's size is bounded. */
export const MAX_PATHS = 100_000
const MAX_PATH_LENGTH = 4096
const MAX_MESSAGE_LENGTH = 1_000_000

/** A git command whose output the user reads, in their own language. */
const run = (root: string, args: string[], input?: string, signal?: AbortSignal): Promise<GitRun> =>
  runGitWithOutput(root, args, { input, signal })

/** A git command whose output the app reads. */
const query = (root: string, args: string[]): Promise<GitRun> =>
  runGitWithOutput(root, args, { parsed: true })

async function runOrThrow(root: string, args: string[]): Promise<string> {
  const result = await query(root, args)
  if (result.exitCode !== 0) throw new Error(result.output.trim() || `git ${args[0]} failed`)
  return result.stdout
}

const outcome = (result: GitRun): GitOutcome =>
  result.cancelled
    ? { ok: false, output: result.output, cancelled: true }
    : { ok: result.exitCode === 0, output: result.output }

/**
 * The index lock a cancelled command left behind, or null. Git removes its locks when stopped, so
 * one still there may belong to another git command: it is reported, never deleted.
 */
export async function leftoverIndexLock(root: string): Promise<string | null> {
  const path = await query(root, [
    'rev-parse',
    '--path-format=absolute',
    '--git-path',
    'index.lock'
  ])
  const lock = path.stdout.trim()
  if (path.exitCode !== 0 || lock === '') return null
  return access(lock).then(
    () => lock,
    () => null
  )
}

/** A path git takes as it is: no glob, no `:(magic)`. */
const literal = (path: string): string => `:(literal)${path}`

/** Git reads the pathspecs from stdin, so the command line stays short however many there are. */
const PATHSPECS_FROM_STDIN = ['--pathspec-from-file=-', '--pathspec-file-nul']

/** `paths` as literal pathspecs for `PATHSPECS_FROM_STDIN`. */
const pathspecInput = (paths: string[]): string =>
  paths.map((path) => `${literal(path)}\0`).join('')

/** The marker each operation leaves in the git dir while it waits to be concluded, rebase first. */
const OPERATION_MARKERS: [GitOperation, string][] = [
  ['rebase', 'rebase-merge'],
  // `git am` keeps its state in rebase-apply too, without this file: it is no rebase.
  ['rebase', 'rebase-apply/rebasing'],
  ['merge', 'MERGE_HEAD'],
  ['cherry-pick', 'CHERRY_PICK_HEAD'],
  ['revert', 'REVERT_HEAD']
]

/** Where each named file of the working tree's git dir is (a linked worktree has its own); null where git can't say. */
async function gitDirPaths(root: string, names: string[]): Promise<(string | null)[]> {
  const result = await query(root, ['rev-parse', ...names.flatMap((name) => ['--git-path', name])])
  const paths = result.exitCode === 0 ? result.stdout.split('\n') : []
  return names.map((_name, index) => {
    const path = paths[index]
    return path ? resolve(root, path) : null
  })
}

const exists = (path: string | null): Promise<boolean> =>
  path === null
    ? Promise.resolve(false)
    : access(path).then(
        () => true,
        () => false
      )

const readText = (path: string | null): Promise<string | null> =>
  path === null ? Promise.resolve(null) : readFile(path, 'utf8').catch(() => null)

/** The merge, cherry-pick, revert or rebase under way in the working tree, as git's own markers say. */
async function operationInProgress(root: string): Promise<GitOperation | null> {
  const paths = await gitDirPaths(
    root,
    OPERATION_MARKERS.map(([, marker]) => marker)
  )
  const present = await Promise.all(paths.map(exists))
  return OPERATION_MARKERS.find((_marker, index) => present[index])?.[0] ?? null
}

/** A line git writes where it couldn't merge: `<<<<<<< ours` or `>>>>>>> theirs`. */
const CONFLICT_MARKER = /^(?:<{7}|>{7})(?: |$)/m

/** The conflicted files among `files` still holding conflict markers: staging one would mark it resolved. */
async function unresolvedConflicts(files: ChangedFile[]): Promise<ChangedFile[]> {
  const conflicted = files.filter((file) => file.kind === 'conflicted')
  const marked = await Promise.all(
    conflicted.map(async (file) => CONFLICT_MARKER.test((await readText(file.absolutePath)) ?? ''))
  )
  return conflicted.filter((_file, index) => marked[index])
}

/**
 * The commit message git prepared for concluding a merge, cherry-pick or revert (MERGE_MSG), with
 * its comment lines (the list of conflicts) taken out as git would; null when it has none.
 */
async function preparedCommitMessage(root: string): Promise<string | null> {
  const [path = null] = await gitDirPaths(root, ['MERGE_MSG'])
  const text = await readText(path)
  if (text === null) return null
  // stripspace knows the configured comment character.
  const stripped = await runGitWithOutput(root, ['stripspace', '--strip-comments'], {
    input: text,
    parsed: true
  })
  const message = stripped.exitCode === 0 ? stripped.stdout.replace(/\n+$/, '') : ''
  return message === '' ? null : message
}

/**
 * The branch being merged: the one local branch pointing at MERGE_HEAD, else the one
 * remote-tracking branch (`origin/main` after a pull); null when none or several do, or the merge
 * takes several heads.
 */
async function mergedBranch(root: string): Promise<string | null> {
  const [path = null] = await gitDirPaths(root, ['MERGE_HEAD'])
  const heads = ((await readText(path)) ?? '').trim().split(/\s+/)
  const [head] = heads
  if (heads.length !== 1 || head === undefined || !/^[0-9a-f]{40,64}$/.test(head)) return null
  const refs = await query(root, [
    'for-each-ref',
    `--points-at=${head}`,
    '--format=%(refname)',
    'refs/heads',
    'refs/remotes'
  ])
  if (refs.exitCode !== 0) return null
  const names = refs.stdout.split('\n').filter((ref) => ref !== '' && !ref.endsWith('/HEAD'))
  for (const prefix of ['refs/heads/', 'refs/remotes/']) {
    const matching = names.filter((ref) => ref.startsWith(prefix))
    if (matching.length > 1) return null
    if (matching[0] !== undefined) return matching[0].slice(prefix.length)
  }
  return null
}

/** The branch, its upstream and every changed file of the working tree at `root`. */
export async function readWorkingTreeStatus(root: string): Promise<WorkingTreeStatus> {
  const [status, kind] = await Promise.all([
    query(root, [...STATUS_ARGS]),
    operationInProgress(root)
  ])
  if (status.exitCode !== 0) throw new Error(status.output.trim() || 'git status failed')
  const { entries, ...branch } = parseStatus(status.stdout)
  const files = entries.map((entry) => ({ ...entry, absolutePath: join(root, entry.path) }))
  if (kind === null) return { ...branch, operation: null, files }
  const [merging, message, conflicts] = await Promise.all([
    kind === 'merge' ? mergedBranch(root) : null,
    kind === 'rebase' ? null : preparedCommitMessage(root),
    unresolvedConflicts(files)
  ])
  return { ...branch, operation: { kind, merging, message, conflicts: conflicts.length }, files }
}

/**
 * The request's paths relative to `root` with `/` separators, refusing any that isn't a string
 * naming something inside it.
 */
function repositoryPaths(root: string, paths: unknown): string[] {
  if (!Array.isArray(paths)) throw new Error('Invalid file list.')
  if (paths.length > MAX_PATHS)
    throw new Error(
      `${paths.length.toLocaleString('en-US')} files are more than one action takes (${MAX_PATHS.toLocaleString('en-US')}). Choose fewer files, or ignore generated folders in .gitignore.`
    )
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
  const head = await query(root, ['rev-parse', '--verify', '-q', 'HEAD'])
  return head.exitCode === 0
    ? 'HEAD'
    : (await runOrThrow(root, ['hash-object', '-t', 'tree', devNull])).trim()
}

/** Runs `commit` with the message in a private temporary file, removed afterwards: stdin carries the paths. */
async function withMessageFile<T>(
  message: string,
  commit: (file: string) => Promise<T>
): Promise<T> {
  const folder = await mkdtemp(join(tmpdir(), 'hatfield-commit-'))
  try {
    const file = join(folder, 'COMMIT_MESSAGE')
    await writeFile(file, message, { mode: 0o600 })
    return await commit(file)
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
}

/**
 * Commits the paths as they are in the working tree, leaving every other change (staged or not)
 * where it was. An untracked file is refused: it is added to version control first. During a
 * merge, cherry-pick or revert the paths are staged and the whole index committed, which concludes
 * it (git refuses a partial commit then); during a rebase nothing is committed.
 */
export async function commitChanges(
  root: string,
  request: { paths: unknown; message: unknown; amend: boolean },
  signal?: AbortSignal
): Promise<GitOutcome> {
  if (typeof request.message !== 'string' || request.message.length > MAX_MESSAGE_LENGTH)
    throw new Error('Invalid commit message.')
  const { message } = request
  const paths = repositoryPaths(root, request.paths)
  if (message.trim() === '') return { ok: false, output: 'Write a commit message.' }
  const operation = await operationInProgress(root)
  if (operation === 'rebase')
    return {
      ok: false,
      output:
        'A rebase is in progress: continue it (git rebase --continue) or abort it (git rebase --abort) in a terminal.'
    }
  if (paths.length === 0 && !request.amend && operation === null)
    return { ok: false, output: 'Choose the files to commit.' }
  const files = paths.length === 0 ? [] : await changedFiles(root, paths)
  const untracked = files.find((file) => file.kind === 'untracked')
  if (untracked) return { ok: false, output: `Add ${untracked.path} to version control first.` }
  // Paths with no changes stay in: git's pathspec check speaks for them.
  const known = new Set(files.flatMap(bothSides))
  const pathspecs = [...new Set([...known, ...paths])]
  const amend = request.amend ? ['--amend'] : []
  if (operation !== null) {
    const [conflict] = await unresolvedConflicts(files)
    if (conflict !== undefined)
      return {
        ok: false,
        output: `${conflict.path} still has conflict markers: resolve them first.`
      }
    if (pathspecs.length > 0) {
      const staged = await run(
        root,
        ['add', '--all', ...PATHSPECS_FROM_STDIN],
        pathspecInput(pathspecs),
        signal
      )
      if (staged.exitCode !== 0) return outcome(staged)
    }
    return withMessageFile(message, async (file) =>
      outcome(await run(root, ['commit', ...amend, `--file=${file}`], undefined, signal))
    )
  }
  return withMessageFile(message, async (file) =>
    outcome(
      await run(
        root,
        [
          'commit',
          '--only',
          ...amend,
          `--file=${file}`,
          ...(pathspecs.length > 0 ? PATHSPECS_FROM_STDIN : [])
        ],
        pathspecs.length > 0 ? pathspecInput(pathspecs) : undefined,
        signal
      )
    )
  )
}

/** The last commit's message as written, or null on a branch without commits. */
export async function lastCommitMessage(root: string): Promise<string | null> {
  const head = await query(root, ['rev-parse', '--verify', '-q', 'HEAD'])
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
  const configured = await query(root, ['config', '--get', 'remote.pushDefault'])
  if (configured.exitCode === 0 && configured.stdout.trim()) return configured.stdout.trim()
  const remotes = (await runOrThrow(root, ['remote'])).split('\n').filter(Boolean)
  if (remotes.includes('origin')) return 'origin'
  return remotes.length === 1 ? (remotes[0] ?? null) : null
}

/**
 * Pushes the current branch; one without an upstream gets one on the remote it is pushed to. Git
 * itself explains a detached HEAD or a repository without remotes.
 */
export async function pushBranch(root: string, signal?: AbortSignal): Promise<GitOutcome> {
  const upstream = await query(root, [
    'rev-parse',
    '--abbrev-ref',
    '--symbolic-full-name',
    '@{upstream}'
  ])
  const branch = await query(root, ['symbolic-ref', '-q', 'HEAD'])
  const remote = upstream.exitCode !== 0 && branch.exitCode === 0 ? await pushRemote(root) : null
  return outcome(
    await run(
      root,
      remote ? ['push', '--set-upstream', remote, 'HEAD'] : ['push'],
      undefined,
      signal
    )
  )
}

export async function pullBranch(root: string, signal?: AbortSignal): Promise<GitOutcome> {
  return outcome(await run(root, ['pull'], undefined, signal))
}

/** `git fetch` as the user would type it: the branch's remote, else `origin`. */
export async function fetchRemote(root: string, signal?: AbortSignal): Promise<GitOutcome> {
  return outcome(await run(root, ['fetch'], undefined, signal))
}

/** The requested paths' status entries once each is known to be untracked in the working tree. */
async function untrackedEntries(root: string, requested: unknown): Promise<ChangedFile[]> {
  const paths = repositoryPaths(root, requested)
  const untracked = new Map(
    (await changedFiles(root, paths))
      .filter((file) => file.kind === 'untracked')
      .map((file) => [file.path, file])
  )
  return paths.map((path) => {
    const entry = untracked.get(path)
    if (entry === undefined) throw new Error(`${path} is not an untracked file.`)
    return entry
  })
}

/**
 * Adds untracked files to the index, so they are listed as added. A nested repository is refused:
 * git would record it as a bare commit pointer (a gitlink), not as its files.
 */
export async function addUntrackedFiles(
  root: string,
  requested: unknown,
  signal?: AbortSignal
): Promise<GitOutcome> {
  const entries = await untrackedEntries(root, requested)
  const nested = entries.find((entry) => entry.nestedRepository)
  if (nested)
    throw new Error(
      `${nested.path} is a nested repository: add it as a submodule in a terminal, or ignore it.`
    )
  if (entries.length === 0) return { ok: true, output: '' }
  return outcome(
    await run(
      root,
      ['add', ...PATHSPECS_FROM_STDIN],
      pathspecInput(entries.map((entry) => entry.path)),
      signal
    )
  )
}

/**
 * Appends a pattern matching exactly the untracked file (or nested repository folder) at `path` to
 * the root's .gitignore, creating it if needed. A linked .gitignore is written through, if it stays
 * in the root.
 */
export async function ignoreUntrackedFile(root: string, requested: unknown): Promise<void> {
  const [entry] = await untrackedEntries(root, [requested])
  if (entry === undefined) throw new Error('Invalid file path.')
  const pattern = `${anchoredIgnorePattern(entry.path)}${entry.nestedRepository ? '/' : ''}`
  const link = join(root, '.gitignore')
  const target = await realpath(link).catch(() => link)
  if (!isPathInside(target, await realpath(root)) && target !== link)
    throw new Error('.gitignore points outside the repository.')
  const current = await readFile(target, 'utf8').catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return ''
    throw error
  })
  const separator = current === '' || current.endsWith('\n') ? '' : '\n'
  await writeFileAtomic(target, `${current}${separator}${pattern}\n`)
}

/**
 * Returns the paths to HEAD in the index and the working tree: a file added since is deleted, a
 * deleted one comes back, a rename is undone on both sides. Paths without changes are left alone;
 * an untracked file is refused, since HEAD has nothing to return it to.
 */
export async function rollbackChanges(
  root: string,
  requested: unknown,
  signal?: AbortSignal
): Promise<GitOutcome> {
  const files = await changedFiles(root, repositoryPaths(root, requested))
  const untracked = files.find((file) => file.kind === 'untracked')
  if (untracked) throw new Error(`${untracked.path} is untracked: nothing to roll back.`)
  const tracked = files.flatMap(bothSides)
  if (tracked.length === 0) return { ok: true, output: '' }
  const head = await query(root, ['rev-parse', '--verify', '-q', 'HEAD'])
  // Without a commit every tracked change is a staged new file: HEAD has none of them.
  return outcome(
    await run(
      root,
      head.exitCode === 0
        ? ['restore', '--source=HEAD', '--staged', '--worktree', ...PATHSPECS_FROM_STDIN]
        : ['rm', '-q', '-f', ...PATHSPECS_FROM_STDIN],
      pathspecInput(tracked),
      signal
    )
  )
}

const ABORTABLE = new Set<unknown>([
  'merge',
  'cherry-pick',
  'revert',
  'rebase'
] satisfies GitOperation[])

/**
 * `git merge|cherry-pick|revert|rebase --abort`, once the operation the user saw is the one under
 * way: anything else, or nothing in progress, is refused before git runs.
 */
export async function abortOperation(
  root: string,
  requested: unknown,
  signal?: AbortSignal
): Promise<GitOutcome> {
  if (!ABORTABLE.has(requested)) throw new Error('Invalid git operation.')
  const operation = await operationInProgress(root)
  if (operation === null)
    return { ok: false, output: 'No merge, cherry-pick, revert or rebase is in progress.' }
  if (operation !== requested)
    return {
      ok: false,
      output: `A ${operation} is in progress, not a ${String(requested)}: nothing was aborted.`
    }
  return outcome(await run(root, [operation, '--abort'], undefined, signal))
}
