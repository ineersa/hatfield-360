import type { ChangedFile, SourceControlGroup } from '../../../../shared/source-control-api'

export type GitGroup = Extract<SourceControlGroup, { status: 'git' }>

/** A changed file's identity across refreshes: its working tree and path. */
export const fileKey = (root: string, path: string): string => `${root}\0${path}`

/** A row of the Commit panel's changes tree. */
export type ChangeRow =
  | { type: 'group'; key: string; group: SourceControlGroup; expanded: boolean }
  | { type: 'file'; key: string; group: GitGroup; file: ChangedFile }
  /** Says why a group lists no files: none changed, not git, or git failed. */
  | { type: 'note'; key: string; note: 'clean' | 'not-git' }
  | { type: 'error'; key: string; message: string }

/** Each group's row, followed (unless folded) by its files or a row saying why it has none. */
export function changeTreeRows(
  groups: readonly SourceControlGroup[],
  collapsed: ReadonlySet<string>
): ChangeRow[] {
  return groups.flatMap((group): ChangeRow[] => {
    const expanded = !collapsed.has(group.root)
    const head: ChangeRow = { type: 'group', key: group.root, group, expanded }
    if (!expanded) return [head]
    const inner = `${group.root}\0`
    if (group.status === 'not-git') return [head, { type: 'note', key: inner, note: 'not-git' }]
    if (group.status === 'error')
      return [head, { type: 'error', key: inner, message: group.message }]
    if (group.files.length === 0) return [head, { type: 'note', key: inner, note: 'clean' }]
    return [
      head,
      ...group.files.map((file): ChangeRow => ({
        type: 'file',
        key: fileKey(group.root, file.path),
        group,
        file
      }))
    ]
  })
}

export type CheckState = 'checked' | 'unchecked' | 'mixed'

export function groupCheckState(group: GitGroup, checked: ReadonlySet<string>): CheckState {
  const count = group.files.filter((file) => checked.has(fileKey(group.root, file.path))).length
  if (count === 0) return 'unchecked'
  return count === group.files.length ? 'checked' : 'mixed'
}

/** Checks every file of the group, or unchecks them all when every one already is. */
export function toggleGroupChecks(group: GitGroup, checked: ReadonlySet<string>): Set<string> {
  const keys = group.files.map((file) => fileKey(group.root, file.path))
  const next = new Set(checked)
  if (groupCheckState(group, checked) === 'checked') for (const key of keys) next.delete(key)
  else for (const key of keys) next.add(key)
  return next
}

/** The checks of files still listed; files that went away (committed, reverted) lose theirs. */
export function keepListedChecks(
  checked: ReadonlySet<string>,
  groups: readonly SourceControlGroup[]
): ReadonlySet<string> {
  const listed = new Set(
    groups.flatMap((group) =>
      group.status === 'git' ? group.files.map((file) => fileKey(group.root, file.path)) : []
    )
  )
  const kept = [...checked].filter((key) => listed.has(key))
  return kept.length === checked.size ? checked : new Set(kept)
}

/** The git groups that have checked files, in workspace order, each with those files. */
export function checkedFilesByGroup(
  groups: readonly SourceControlGroup[],
  checked: ReadonlySet<string>
): { group: GitGroup; files: ChangedFile[] }[] {
  return groups.flatMap((group) => {
    if (group.status !== 'git') return []
    const files = group.files.filter((file) => checked.has(fileKey(group.root, file.path)))
    return files.length > 0 ? [{ group, files }] : []
  })
}
