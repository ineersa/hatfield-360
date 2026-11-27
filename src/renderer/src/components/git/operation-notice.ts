import type { GitOperation } from '../../../../shared/source-control-api'
import type { GitGroup } from './change-tree-rows'

/** Each operation as a sentence names it, and as a title starts it. */
export const OPERATION_NAMES: Record<GitOperation, { noun: string; title: string }> = {
  merge: { noun: 'merge', title: 'Merge' },
  'cherry-pick': { noun: 'cherry-pick', title: 'Cherry-pick' },
  revert: { noun: 'revert', title: 'Revert' },
  rebase: { noun: 'rebase', title: 'Rebase' }
}

/** "1 file", "3 files". */
const files = (count: number): string => (count === 1 ? '1 file' : `${count} files`)

/**
 * What the notice at the top of a group says about the operation under way: what it is, what is
 * merged into what when git says, and what is left to do; null when nothing is in progress.
 */
export function operationNotice(
  group: GitGroup
): { title: string; detail: string | null; status: string } | null {
  const { operation } = group
  if (operation === null) return null
  const { noun, title } = OPERATION_NAMES[operation.kind]
  const detail =
    operation.merging === null
      ? null
      : `Merging ${operation.merging}${group.branch === null ? '' : ` into ${group.branch}`}.`
  const next = operation.kind === 'rebase' ? 'continue the rebase in a terminal' : 'commit'
  const status =
    operation.conflicts > 0
      ? `${files(operation.conflicts)} with conflicts: resolve ${operation.conflicts === 1 ? 'it' : 'them'}, then ${next}.`
      : operation.kind === 'rebase'
        ? 'Continue it in a terminal (git rebase --continue), or abort it.'
        : `No conflicts left: commit to conclude the ${noun}.`
  return { title: `${title} in progress`, detail, status }
}

/** What aborting the operation loses, as the confirmation says it; checked against what git does. */
export function abortConsequence(operation: GitOperation): string {
  if (operation === 'rebase')
    return 'The branch and its files go back to how they were before the rebase started. Commits it made and changes since, committed or not, are lost.'
  const { noun } = OPERATION_NAMES[operation]
  return `Files the ${noun} changed go back to how they were before it, and conflict resolutions made since are lost. Changes to other files are kept.`
}
