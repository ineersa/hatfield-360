import type { ChangedFile, SourceControlGroup } from '../../../../shared/source-control-api'

export type GitGroup = Extract<SourceControlGroup, { status: 'git' }>

/** A changed file's identity across refreshes: its working tree and path. */
export const fileKey = (root: string, path: string): string => `${root}\0${path}`

/** The Unversioned Files row of a group; no path holds `\0`, so no file shares it. */
const unversionedKey = (root: string): string => `${root}\0unversioned\0`

/** The notice of a group's operation in progress. */
const operationKey = (root: string): string => `${root}\0operation\0`

export const isUntracked = (file: ChangedFile): boolean => file.kind === 'untracked'

/** The changes that can be committed: an untracked file is added to version control first. */
export const trackedFiles = (group: GitGroup): ChangedFile[] =>
  group.files.filter((file) => !isUntracked(file))

export const untrackedFiles = (group: GitGroup): ChangedFile[] => group.files.filter(isUntracked)

/** The untracked files that can be added to version control: a nested repository can't. */
export const addableFiles = (group: GitGroup): ChangedFile[] =>
  untrackedFiles(group).filter((file) => !file.nestedRepository)

/** A row of the Commit panel's changes tree. */
export type ChangeRow =
  | { type: 'group'; key: string; group: SourceControlGroup; expanded: boolean }
  /** `depth` 2 is under the group's Unversioned Files row. */
  | { type: 'file'; key: string; group: GitGroup; file: ChangedFile; depth: 1 | 2 }
  | { type: 'unversioned'; key: string; group: GitGroup; files: ChangedFile[]; expanded: boolean }
  /** The merge, cherry-pick, revert or rebase under way in the group, above its files. */
  | { type: 'operation'; key: string; group: GitGroup }
  /** Says why a group lists no files: none changed, not git, or git failed. */
  | { type: 'note'; key: string; note: 'clean' | 'not-git' }
  | { type: 'error'; key: string; message: string }

const fileRows = (group: GitGroup, files: ChangedFile[], depth: 1 | 2): ChangeRow[] =>
  files.map((file) => ({ type: 'file', key: fileKey(group.root, file.path), group, file, depth }))

/** Conflicted files first, the rest in git's order: during an operation they are what blocks the commit. */
const conflictsFirst = (files: ChangedFile[]): ChangedFile[] => [
  ...files.filter((file) => file.kind === 'conflicted'),
  ...files.filter((file) => file.kind !== 'conflicted')
]

/**
 * Each group's row, followed (unless folded) by the notice of an operation in progress, its
 * tracked changes (conflicted first during an operation) and then its Unversioned Files row,
 * folded unless its root is in `unversionedOpen`, or a row saying why it has none.
 */
export function changeTreeRows(
  groups: readonly SourceControlGroup[],
  collapsed: ReadonlySet<string>,
  unversionedOpen: ReadonlySet<string>
): ChangeRow[] {
  return groups.flatMap((group): ChangeRow[] => {
    const expanded = !collapsed.has(group.root)
    const head: ChangeRow = { type: 'group', key: group.root, group, expanded }
    if (!expanded) return [head]
    const inner = `${group.root}\0`
    if (group.status === 'not-git') return [head, { type: 'note', key: inner, note: 'not-git' }]
    if (group.status === 'error')
      return [head, { type: 'error', key: inner, message: group.message }]
    const notice: ChangeRow[] =
      group.operation === null ? [] : [{ type: 'operation', key: operationKey(group.root), group }]
    if (group.files.length === 0)
      return [head, ...notice, { type: 'note', key: inner, note: 'clean' }]
    const untracked = untrackedFiles(group)
    const open = unversionedOpen.has(group.root)
    const unversioned: ChangeRow[] =
      untracked.length === 0
        ? []
        : [
            {
              type: 'unversioned',
              key: unversionedKey(group.root),
              group,
              files: untracked,
              expanded: open
            },
            ...(open ? fileRows(group, untracked, 2) : [])
          ]
    const tracked =
      group.operation === null ? trackedFiles(group) : conflictsFirst(trackedFiles(group))
    return [head, ...notice, ...fileRows(group, tracked, 1), ...unversioned]
  })
}

export type CheckState = 'checked' | 'unchecked' | 'mixed'

/** How many of `files` (of the working tree at `root`) are in `checked`: none, some or all. */
export function filesCheckState(
  root: string,
  files: readonly ChangedFile[],
  checked: ReadonlySet<string>
): CheckState {
  const count = files.filter((file) => checked.has(fileKey(root, file.path))).length
  if (count === 0) return 'unchecked'
  return count === files.length ? 'checked' : 'mixed'
}

/** Adds every one of `files` to `checked`, or takes them all out when every one already is in. */
export function toggleFilesChecks(
  root: string,
  files: readonly ChangedFile[],
  checked: ReadonlySet<string>
): Set<string> {
  const keys = files.map((file) => fileKey(root, file.path))
  const next = new Set(checked)
  if (filesCheckState(root, files, checked) === 'checked') for (const key of keys) next.delete(key)
  else for (const key of keys) next.add(key)
  return next
}

/**
 * The keys of `checked` whose files are still listed among `filesOf` each git group; files that
 * went away (committed, reverted) or changed side (added to version control) lose theirs.
 */
export function keepListedChecks(
  checked: ReadonlySet<string>,
  groups: readonly SourceControlGroup[],
  filesOf: (group: GitGroup) => ChangedFile[]
): ReadonlySet<string> {
  const listed = new Set(
    groups.flatMap((group) =>
      group.status === 'git' ? filesOf(group).map((file) => fileKey(group.root, file.path)) : []
    )
  )
  const kept = [...checked].filter((key) => listed.has(key))
  return kept.length === checked.size ? checked : new Set(kept)
}

/** The git groups with files of `filesOf` in `checked`, in workspace order, each with those files. */
export function checkedFilesByGroup(
  groups: readonly SourceControlGroup[],
  checked: ReadonlySet<string>,
  filesOf: (group: GitGroup) => ChangedFile[]
): { group: GitGroup; files: ChangedFile[] }[] {
  return groups.flatMap((group) => {
    if (group.status !== 'git') return []
    const files = filesOf(group).filter((file) => checked.has(fileKey(group.root, file.path)))
    return files.length > 0 ? [{ group, files }] : []
  })
}
