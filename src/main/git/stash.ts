import type { GitOutcome } from '../../shared/source-control-api'
import type { StashEntry } from '../../shared/stash-api'
import {
  bothSides,
  changedFiles,
  MAX_MESSAGE_LENGTH,
  outcome,
  PATHSPECS_FROM_STDIN,
  pathspecInput,
  query,
  repositoryPaths,
  run,
  untrackedEntries
} from './source-control'

/** One stash per record: its commit, git's reflog subject and when it was made. */
const LIST_FORMAT = '%H%x00%gs%x00%ct%x1e'

/** `On main: message`, or `WIP on main: 1a2b3c4 subject` for a stash made without one. */
const SUBJECT = /^(?:WIP on|On) (.*?): ([\s\S]*)$/

const STASH_ID = /^[0-9a-f]{40,64}$/

/** The repository's stashes, newest first. */
export async function listStashes(root: string): Promise<StashEntry[]> {
  const result = await query(root, ['stash', 'list', `--format=${LIST_FORMAT}`])
  if (result.exitCode !== 0) throw new Error(result.output.trim() || 'git stash list failed')
  return result.stdout
    .split('\x1e')
    .map((record) => record.replace(/^\n/, ''))
    .filter((record) => record !== '')
    .map((record) => {
      const [id = '', subject = '', seconds = '0'] = record.split('\0')
      const parsed = SUBJECT.exec(subject)
      return {
        id,
        branch: parsed?.[1] === undefined || parsed[1] === '(no branch)' ? null : parsed[1],
        message: parsed?.[2] ?? subject,
        createdAt: Number(seconds) * 1000
      }
    })
}

/**
 * Puts the files among `paths` that the index has deleted (a staged deletion, a rename's old side)
 * back in the index as they are in HEAD: `git stash push` only takes paths the index knows, and an
 * unstaged deletion is stashed the same. Their failure, else null.
 */
async function unstageDeletions(
  root: string,
  paths: string[],
  signal?: AbortSignal
): Promise<GitOutcome | null> {
  const deleted = await query(root, [
    'diff',
    '--cached',
    '--no-renames',
    '--name-only',
    '--diff-filter=D',
    '-z'
  ])
  if (deleted.exitCode !== 0) return outcome(deleted)
  const chosen = new Set(paths)
  const gone = deleted.stdout.split('\0').filter((path) => chosen.has(path))
  if (gone.length === 0) return null
  const reset = await run(
    root,
    ['reset', '-q', 'HEAD', ...PATHSPECS_FROM_STDIN],
    pathspecInput(gone),
    signal
  )
  return reset.exitCode === 0 ? null : outcome(reset)
}

/**
 * Stashes the tracked `paths` (both sides of a rename) and the untracked `untracked`, leaving
 * every other change, staged or not, where it was. Nothing chosen is refused: git would stash it all.
 */
export async function stashChanges(
  root: string,
  request: { paths: unknown; untracked: unknown; message: unknown },
  signal?: AbortSignal
): Promise<GitOutcome> {
  if (typeof request.message !== 'string' || request.message.length > MAX_MESSAGE_LENGTH)
    throw new Error('Invalid stash message.')
  const paths = repositoryPaths(root, request.paths)
  const untracked = await untrackedEntries(root, request.untracked)
  const nested = untracked.find((entry) => entry.nestedRepository)
  if (nested) throw new Error(`${nested.path} is a nested repository: it can't be stashed.`)
  const files = paths.length === 0 ? [] : await changedFiles(root, paths)
  const stray = files.find((file) => file.kind === 'untracked')
  if (stray) throw new Error(`${stray.path} is untracked: choose it under Unversioned Files.`)
  const tracked = files.flatMap(bothSides)
  const pathspecs = [...new Set([...tracked, ...untracked.map((entry) => entry.path)])]
  if (pathspecs.length === 0)
    return { ok: false, output: 'None of these files has changes to stash.' }
  const unstaged = await unstageDeletions(root, pathspecs, signal)
  if (unstaged !== null) return unstaged
  const message = request.message.trim()
  return outcome(
    await run(
      root,
      [
        'stash',
        'push',
        ...(untracked.length > 0 ? ['--include-untracked'] : []),
        ...(message === '' ? [] : ['--message', message]),
        ...PATHSPECS_FROM_STDIN
      ],
      pathspecInput(pathspecs),
      signal
    )
  )
}

/**
 * `stash@{n}` for the stash whose commit is `id`, read now: an index shifts as stashes come and
 * go, the commit doesn't. Null when that stash is gone.
 */
async function stashRef(root: string, id: unknown): Promise<string | null> {
  if (typeof id !== 'string' || !STASH_ID.test(id)) throw new Error('Invalid stash.')
  const index = (await listStashes(root)).findIndex((entry) => entry.id === id)
  return index === -1 ? null : `stash@{${index}}`
}

const GONE: GitOutcome = {
  ok: false,
  output: 'That stash is no longer there: it was popped or dropped meanwhile.'
}

/**
 * Applies the stash to the working tree; `pop` removes it once applied. A conflict leaves the
 * conflicted files to resolve and keeps the stash, as git does.
 */
export async function unstash(
  root: string,
  id: unknown,
  pop: boolean,
  signal?: AbortSignal
): Promise<GitOutcome> {
  const ref = await stashRef(root, id)
  if (ref === null) return GONE
  return outcome(await run(root, ['stash', pop ? 'pop' : 'apply', ref], undefined, signal))
}

export async function dropStash(
  root: string,
  id: unknown,
  signal?: AbortSignal
): Promise<GitOutcome> {
  const ref = await stashRef(root, id)
  if (ref === null) return GONE
  return outcome(await run(root, ['stash', 'drop', ref], undefined, signal))
}

/** The `stash@{n}` hunk opens for the stash `id`; it is refused once that stash is gone. */
export async function stashToShow(root: string, id: unknown): Promise<string> {
  const ref = await stashRef(root, id)
  if (ref === null) throw new Error(GONE.output)
  return ref
}
