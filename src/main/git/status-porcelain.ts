import type { ChangeKind } from '../../shared/source-control-api'

/** One changed path as `git status` reports it, relative to the working tree's top. */
export type StatusEntry = {
  /** `/`-separated; a nested repository without git's trailing slash. */
  path: string
  /** Where a renamed or copied file came from; null for every other entry. */
  originalPath: string | null
  kind: ChangeKind
  /** An untracked nested repository or linked worktree, which git lists as one `dir/`. */
  nestedRepository: boolean
}

export type WorkingTreeState = {
  /** Null when HEAD is detached; a branch without commits has its name. */
  branch: string | null
  upstream: string | null
  /** Both null without an upstream; both 0 when the upstream branch is gone. */
  ahead: number | null
  behind: number | null
  entries: StatusEntry[]
}

/** The arguments whose output `parseStatus` reads: NUL-terminated, so any path comes through as it is. */
export const STATUS_ARGS = [
  'status',
  '--porcelain=v2',
  '--branch',
  '-z',
  '--untracked-files=all'
] as const

/** How a tracked change shows in the Commit panel, from its index and work tree letters (`.` unchanged). */
function trackedKind(xy: string): ChangeKind {
  const index = xy[0]
  if (xy.includes('R')) return 'renamed'
  if (index === 'A' || index === 'C') return 'added'
  if (xy.includes('D')) return 'deleted'
  return 'modified'
}

/** The text after the first `count` space-separated fields of a record: the path, spaces and all. */
function afterFields(record: string, count: number): string {
  let index = 0
  for (let field = 0; field < count; field += 1) {
    index = record.indexOf(' ', index) + 1
    if (index === 0) throw new Error(`Unexpected git status record: ${record}`)
  }
  return record.slice(index)
}

/** Parses `git status` run with `STATUS_ARGS`. */
export function parseStatus(output: string): WorkingTreeState {
  const records = output.split('\0')
  const state: WorkingTreeState = {
    branch: null,
    upstream: null,
    ahead: null,
    behind: null,
    entries: []
  }
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] ?? ''
    if (record === '') continue
    if (record.startsWith('# ')) {
      const [, key = '', ...rest] = record.split(' ')
      const value = rest.join(' ')
      if (key === 'branch.head') state.branch = value === '(detached)' ? null : value
      else if (key === 'branch.upstream') {
        state.upstream = value
        // Without a `branch.ab` line the upstream branch is gone: nothing to count against.
        state.ahead = 0
        state.behind = 0
      } else if (key === 'branch.ab') {
        const counts = /^\+(\d+) -(\d+)$/.exec(value)
        if (counts) {
          state.ahead = Number(counts[1])
          state.behind = Number(counts[2])
        }
      }
      continue
    }
    const type = record[0]
    const xy = record.slice(2, 4)
    if (type === '1') {
      state.entries.push({
        path: afterFields(record, 8),
        originalPath: null,
        kind: trackedKind(xy),
        nestedRepository: false
      })
    } else if (type === '2') {
      // A rename or copy: its original path is the next record.
      index += 1
      state.entries.push({
        path: afterFields(record, 9),
        originalPath: records[index] ?? null,
        kind: trackedKind(xy),
        nestedRepository: false
      })
    } else if (type === 'u') {
      state.entries.push({
        path: afterFields(record, 10),
        originalPath: null,
        kind: 'conflicted',
        nestedRepository: false
      })
    } else if (type === '?') {
      const path = record.slice(2)
      const nestedRepository = path.endsWith('/')
      state.entries.push({
        path: nestedRepository ? path.slice(0, -1) : path,
        originalPath: null,
        kind: 'untracked',
        nestedRepository
      })
    }
  }
  return state
}
