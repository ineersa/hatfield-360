import type {
  BranchDeletion,
  BranchList,
  LocalBranch,
  LostCommit,
  RemoteBranch,
  SwitchPreview
} from '../../shared/branch-api'
import type { GitOutcome } from '../../shared/source-control-api'
import { isPlainObject } from '../../shared/plain-object'
import { type GitRun, runGitWithOutput } from './git-command'

const MAX_NAME_LENGTH = 255
/** Conflicting files named in the Switch dialog; the rest are counted. */
const CONFLICTS_SHOWN = 10
/** Lost commits named in a delete confirmation; the rest are counted. */
const LOST_COMMITS_SHOWN = 20

const run = (root: string, args: string[], signal?: AbortSignal): Promise<GitRun> =>
  runGitWithOutput(root, args, { signal })

const query = (root: string, args: string[]): Promise<GitRun> =>
  runGitWithOutput(root, args, { parsed: true })

async function queryOrThrow(root: string, args: string[]): Promise<string> {
  const result = await query(root, args)
  if (result.exitCode !== 0) throw new Error(result.output.trim() || `git ${args[0]} failed`)
  return result.stdout
}

const outcome = (result: GitRun): GitOutcome =>
  result.cancelled
    ? { ok: false, output: result.output, cancelled: true }
    : { ok: result.exitCode === 0, output: result.output }

const FIELDS = [
  '%(refname)',
  '%(HEAD)',
  '%(upstream:short)',
  '%(upstream:track,nobracket)',
  '%(worktreepath)',
  '%(symref)'
]

/** "ahead 2, behind 1", "gone" or "" (in step) from `%(upstream:track,nobracket)`. */
function tracking(track: string): { ahead: number; behind: number; gone: boolean } {
  const count = (word: string): number => Number(new RegExp(`${word} (\\d+)`).exec(track)?.[1] ?? 0)
  return { ahead: count('ahead'), behind: count('behind'), gone: track === 'gone' }
}

/** The remote a remote-tracking ref belongs to: the longest remote name it starts with. */
function splitRemote(name: string, remotes: string[]): { remote: string; branch: string } | null {
  const remote = remotes
    .filter((candidate) => name.startsWith(`${candidate}/`))
    .toSorted((a, b) => b.length - a.length)[0]
  return remote === undefined ? null : { remote, branch: name.slice(remote.length + 1) }
}

/** The working tree's branches: the current one first, then by name; remote ones by remote. */
export async function listBranches(root: string): Promise<BranchList> {
  const [refs, remotes, current, head] = await Promise.all([
    queryOrThrow(root, [
      'for-each-ref',
      `--format=${FIELDS.join('%00')}`,
      'refs/heads',
      'refs/remotes'
    ]),
    queryOrThrow(root, ['remote']),
    query(root, ['symbolic-ref', '-q', '--short', 'HEAD']),
    query(root, ['rev-parse', '--short', '-q', '--verify', 'HEAD'])
  ])
  const remoteNames = remotes.split('\n').filter(Boolean)
  const local: LocalBranch[] = []
  const remote: RemoteBranch[] = []
  for (const line of refs.split('\n')) {
    const [ref = '', marker, upstream = '', track = '', worktree = '', symref = ''] =
      line.split('\0')
    if (ref.startsWith('refs/heads/')) {
      const { ahead, behind, gone } = tracking(track)
      const isCurrent = marker === '*'
      local.push({
        name: ref.slice('refs/heads/'.length),
        current: isCurrent,
        upstream: upstream || null,
        upstreamGone: gone,
        ahead: upstream && !gone ? ahead : null,
        behind: upstream && !gone ? behind : null,
        worktree: !isCurrent && worktree ? worktree : null
      })
    } else if (ref.startsWith('refs/remotes/') && symref === '') {
      const name = ref.slice('refs/remotes/'.length)
      const parts = splitRemote(name, remoteNames)
      if (parts) remote.push({ name, ...parts })
    }
  }
  const currentName = current.exitCode === 0 ? current.stdout.trim() || null : null
  // A branch without commits yet has no ref: it is still the one checked out.
  if (currentName !== null && !local.some((branch) => branch.name === currentName))
    local.push({
      name: currentName,
      current: true,
      upstream: null,
      upstreamGone: false,
      ahead: null,
      behind: null,
      worktree: null
    })
  return {
    current: currentName,
    head: head.exitCode === 0 ? head.stdout.trim() || null : null,
    local: local.toSorted((a, b) => Number(b.current) - Number(a.current)),
    remote
  }
}

/** A branch name from the renderer: a string, short enough, and not something git reads as an option. */
function requestedName(name: unknown): string {
  if (
    typeof name !== 'string' ||
    name === '' ||
    name.length > MAX_NAME_LENGTH ||
    name.includes('\0')
  )
    throw new Error('Invalid branch name.')
  return name
}

/** The listed local branch called `name`, or an error naming it. */
function localBranch(list: BranchList, name: string): LocalBranch {
  const branch = list.local.find((candidate) => candidate.name === name)
  if (!branch) throw new Error(`There is no branch named ${name}.`)
  return branch
}

function remoteBranch(list: BranchList, name: string): RemoteBranch {
  const branch = list.remote.find((candidate) => candidate.name === name)
  if (!branch) throw new Error(`There is no remote branch named ${name}.`)
  return branch
}

const heldElsewhere = (branch: LocalBranch): GitOutcome => ({
  ok: false,
  output: `${branch.name} is checked out in ${branch.worktree ?? 'another worktree'}: switch there instead, or check out another branch in it first.\n`
})

/** A switch request from the renderer, checked against the listed branches. */
function switchRequest(list: BranchList, requested: unknown): LocalBranch | RemoteBranch {
  if (!isPlainObject(requested) || (requested.kind !== 'local' && requested.kind !== 'remote'))
    throw new Error('Invalid branch.')
  const name = requestedName(requested.name)
  if (requested.kind === 'local') return localBranch(list, name)
  const target = remoteBranch(list, name)
  return list.local.find((branch) => branch.upstream === target.name) ?? target
}

/** Paths in `git status --porcelain -z` output; a rename's original path is skipped. */
function statusPaths(status: string): string[] {
  const fields = status.split('\0')
  const paths: string[] = []
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index] ?? ''
    if (field.length < 4) continue
    paths.push(field.slice(3))
    if (field[0] === 'R' || field[0] === 'C') index++
  }
  return paths
}

/**
 * The local changes a switch to a listed branch carries, and those that differ on the branch:
 * git refuses to switch over them.
 */
export async function previewSwitch(root: string, requested: unknown): Promise<SwitchPreview> {
  const list = await listBranches(root)
  const target = switchRequest(list, requested)
  const ref = 'remote' in target ? `refs/remotes/${target.name}` : `refs/heads/${target.name}`
  const status = await queryOrThrow(root, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all'
  ])
  const changed = statusPaths(status)
  const differing =
    list.head === null || ('current' in target && target.current)
      ? ''
      : await queryOrThrow(root, ['diff', '--no-ext-diff', '--name-only', '-z', 'HEAD', ref, '--'])
  const onBranch = new Set(differing.split('\0').filter(Boolean))
  const conflicting = changed.filter((path) => onBranch.has(path))
  return {
    branch: target.name,
    changed: changed.length,
    conflicting: conflicting.slice(0, CONFLICTS_SHOWN),
    more: Math.max(0, conflicting.length - CONFLICTS_SHOWN)
  }
}

/**
 * Switches to a listed branch. A remote one goes through the local branch tracking it, or a new
 * one git creates with its name.
 */
export async function switchBranch(
  root: string,
  requested: unknown,
  signal?: AbortSignal
): Promise<GitOutcome> {
  const target = switchRequest(await listBranches(root), requested)
  if ('remote' in target)
    return outcome(await run(root, ['switch', '--track', '--', target.name], signal))
  return switchToLocal(root, target, signal)
}

async function switchToLocal(
  root: string,
  branch: LocalBranch,
  signal?: AbortSignal
): Promise<GitOutcome> {
  if (branch.current) return { ok: true, output: '' }
  if (branch.worktree !== null) return heldElsewhere(branch)
  return outcome(await run(root, ['switch', '--', branch.name], signal))
}

/** Why git wouldn't take `name` as a new branch, or null when it would. */
async function nameProblem(root: string, name: string): Promise<string | null> {
  if (name.startsWith('-') || name === 'HEAD' || /\s/.test(name))
    return `${name} is not a valid branch name.`
  const format = await query(root, ['check-ref-format', `refs/heads/${name}`])
  if (format.exitCode !== 0) return `${name} is not a valid branch name.`
  const existing = await query(root, ['rev-parse', '--verify', '-q', `refs/heads/${name}`])
  return existing.exitCode === 0 ? `A branch named ${name} already exists.` : null
}

/** The ref a listed start point names, so a name never resolves to something else. */
function startRef(list: BranchList, start: unknown): string {
  if (!isPlainObject(start)) throw new Error('Invalid start point.')
  if (start.kind === 'head') return 'HEAD'
  const name = requestedName(start.name)
  if (start.kind === 'local') return `refs/heads/${localBranch(list, name).name}`
  if (start.kind === 'remote') return `refs/remotes/${remoteBranch(list, name).name}`
  throw new Error('Invalid start point.')
}

/** Creates a branch at a listed start point, switching to it when asked. */
export async function createBranch(
  root: string,
  request: { name: unknown; start: unknown; switchTo: unknown },
  signal?: AbortSignal
): Promise<GitOutcome> {
  if (typeof request.switchTo !== 'boolean') throw new Error('Invalid branch request.')
  const name = requestedName(request.name)
  const start = startRef(await listBranches(root), request.start)
  const problem = await nameProblem(root, name)
  if (problem !== null) return { ok: false, output: `${problem}\n` }
  return outcome(
    await run(
      root,
      request.switchTo ? ['switch', '-c', name, '--', start] : ['branch', '--', name, start],
      signal
    )
  )
}

/** The commits only `name` holds: what deleting it would leave unreachable. */
async function lostCommits(
  root: string,
  name: string
): Promise<{ commits: LostCommit[]; more: number }> {
  const only = [`refs/heads/${name}`, '--not', `--exclude=refs/heads/${name}`, '--all']
  const [count, log] = await Promise.all([
    queryOrThrow(root, ['rev-list', '--count', ...only]),
    queryOrThrow(root, [
      'log',
      '--no-show-signature',
      `--max-count=${LOST_COMMITS_SHOWN}`,
      '--format=%h%x00%s',
      ...only
    ])
  ])
  const commits = log
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash = '', subject = ''] = line.split('\0')
      return { hash, subject }
    })
  return { commits, more: Math.max(0, Number(count.trim()) - commits.length) }
}

/** Whether `git branch -d` takes the branch: merged into its upstream, or HEAD when it has none. */
async function isMerged(root: string, branch: LocalBranch): Promise<boolean> {
  const into =
    branch.upstream !== null && !branch.upstreamGone ? `refs/remotes/${branch.upstream}` : 'HEAD'
  const merged = await query(root, [
    'merge-base',
    '--is-ancestor',
    `refs/heads/${branch.name}`,
    into
  ])
  return merged.exitCode === 0
}

/**
 * Deletes a local branch other than the current one or one checked out elsewhere. Refused as
 * unmerged, the outcome carries the commits only that branch holds.
 */
export async function deleteBranch(
  root: string,
  requested: unknown,
  force: unknown,
  signal?: AbortSignal
): Promise<BranchDeletion> {
  if (typeof force !== 'boolean') throw new Error('Invalid delete request.')
  const branch = localBranch(await listBranches(root), requestedName(requested))
  if (branch.current)
    return { ok: false, output: `${branch.name} is checked out: switch to another branch first.\n` }
  if (branch.worktree !== null) return heldElsewhere(branch)
  const result = outcome(
    await run(root, ['branch', force ? '-D' : '-d', '--', branch.name], signal)
  )
  if (result.ok || force || 'cancelled' in result || (await isMerged(root, branch))) return result
  return { ...result, unmerged: await lostCommits(root, branch.name) }
}
