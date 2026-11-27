import type { GitOutcome } from '../../shared/source-control-api'
import { MAX_STASH_MESSAGE_LENGTH, type StashEntry } from '../../shared/stash-api'
import {
  bothSides,
  changedFiles,
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
      const branch = parsed?.[1]
      // A stash git made itself (a rebase's autostash, `git stash store`) has a subject of its own.
      return {
        id,
        branch: branch === undefined || branch === '(no branch)' ? null : branch,
        detached: branch === '(no branch)',
        message: parsed?.[2] ?? subject,
        createdAt: Number(seconds) * 1000
      }
    })
}

/**
 * Puts the files among `paths` that the index has deleted (a staged deletion, a rename's old side)
 * back in the index as they are in HEAD: `git stash push` only takes paths the index knows, and an
 * unstaged deletion is stashed the same. The paths put back, or the failure.
 */
async function unstageDeletions(
  root: string,
  paths: string[],
  signal?: AbortSignal
): Promise<string[] | GitOutcome> {
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
  if (gone.length === 0) return gone
  const reset = await run(
    root,
    ['reset', '-q', 'HEAD', ...PATHSPECS_FROM_STDIN],
    pathspecInput(gone),
    signal
  )
  return reset.exitCode === 0 ? gone : outcome(reset)
}

/**
 * Stages the deletions `unstageDeletions` put back, after a stash that didn't happen: the staging
 * is left as the user had it. Not cancellable, so a Stop can't leave it half done.
 */
async function restageDeletions(root: string, paths: string[]): Promise<string | null> {
  if (paths.length === 0) return null
  const restaged = await run(
    root,
    ['rm', '--cached', '-q', '--ignore-unmatch', ...PATHSPECS_FROM_STDIN],
    pathspecInput(paths)
  )
  return restaged.exitCode === 0
    ? null
    : `Staging the deletion of ${paths.join(', ')} again failed: ${restaged.output.trim()}`
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
  if (typeof request.message !== 'string') throw new Error('Invalid stash message.')
  // It goes to git as one argument, which the OS caps (128 KiB on Linux).
  if (request.message.length > MAX_STASH_MESSAGE_LENGTH)
    throw new Error(
      `A stash message is at most ${MAX_STASH_MESSAGE_LENGTH.toLocaleString('en')} characters.`
    )
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
  if (!Array.isArray(unstaged)) return unstaged
  const message = request.message.trim()
  const pushed = outcome(
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
  if (pushed.ok) return pushed
  const restaged = await restageDeletions(root, unstaged)
  return restaged === null ? pushed : { ...pushed, output: `${pushed.output}\n${restaged}` }
}

function stashId(id: unknown): string {
  if (typeof id !== 'string' || !STASH_ID.test(id)) throw new Error('Invalid stash.')
  return id
}

/**
 * `stash@{n}` for the stash whose commit is `id`, read now: an index shifts as stashes come and
 * go, the commit doesn't. Null when that stash is gone.
 */
async function stashRef(root: string, id: string): Promise<string | null> {
  const index = (await listStashes(root)).findIndex((entry) => entry.id === id)
  return index === -1 ? null : `stash@{${index}}`
}

const GONE: GitOutcome = {
  ok: false,
  output: 'That stash is no longer there: it was popped or dropped meanwhile.'
}

/** What git prints for a drop: `Dropped stash@{1} (<commit>)`. */
const DROPPED = /^Dropped .* \(([0-9a-f]{40,64})\)$/m

/**
 * Drops the stash `id`. Its `stash@{n}` is read just before, and a stash pushed or dropped in that
 * moment (by a terminal or an agent) would shift it: git names what it dropped, and anything else
 * is stored back.
 */
async function dropById(root: string, id: string, signal?: AbortSignal): Promise<GitOutcome> {
  const ref = await stashRef(root, id)
  if (ref === null) return GONE
  const dropped = outcome(await run(root, ['stash', 'drop', ref], undefined, signal))
  const other = DROPPED.exec(dropped.output)?.[1]
  if (!dropped.ok || other === undefined || other === id) return dropped
  const subject = await query(root, ['log', '-1', '--format=%s', other])
  const stored = await run(root, ['stash', 'store', '--message', subject.stdout.trim(), other])
  return {
    ok: false,
    output:
      stored.exitCode === 0
        ? 'The stashes changed meanwhile, so nothing was dropped. Try again.'
        : `The stashes changed meanwhile, and stash ${other} was dropped instead. Store it back with: git stash store ${other}\n${stored.output}`
  }
}

/**
 * Applies the stash to the working tree, staging what it had staged when that still fits the
 * index; `pop` drops it once applied. A conflict leaves the conflicted files to resolve and keeps
 * the stash, as git does.
 */
export async function unstash(
  root: string,
  id: unknown,
  pop: boolean,
  signal?: AbortSignal
): Promise<GitOutcome> {
  const stash = stashId(id)
  if ((await stashRef(root, stash)) === null) return GONE
  // The commit itself, never stash@{n}: what is applied can't be another stash.
  let applied = outcome(await run(root, ['stash', 'apply', '--index', stash], undefined, signal))
  // The index changed since (a staged file the stash also holds): git touched nothing.
  if (!applied.ok && !applied.cancelled && /Try without --index/.test(applied.output))
    applied = outcome(await run(root, ['stash', 'apply', stash], undefined, signal))
  if (!applied.ok || !pop) return applied
  const dropped = await dropById(root, stash, signal)
  return dropped.ok || dropped === GONE
    ? applied
    : { ok: false, output: `Applied, but the stash was kept:\n${dropped.output}` }
}

export async function dropStash(
  root: string,
  id: unknown,
  signal?: AbortSignal
): Promise<GitOutcome> {
  return dropById(root, stashId(id), signal)
}

/** The `stash@{n}` hunk opens for the stash `id`; it is refused once that stash is gone. */
export async function stashToShow(root: string, id: unknown): Promise<string> {
  const ref = await stashRef(root, stashId(id))
  if (ref === null) throw new Error(GONE.output)
  return ref
}
