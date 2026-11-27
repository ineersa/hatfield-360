import type {
  ChangedFile,
  GitOperation,
  SourceControlGroup
} from '../../../../shared/source-control-api'
import { checkedFilesByGroup, type GitGroup, trackedFiles } from './change-tree-rows'

/** Files of one working tree a commit works on. */
type CommitWork = { group: GitGroup; files: ChangedFile[] }

export const gitGroups = (groups: readonly SourceControlGroup[] | null): GitGroup[] =>
  (groups ?? []).filter((group): group is GitGroup => group.status === 'git')

/**
 * The one working tree Amend replaces the last commit of: the one with checked files, else the
 * selected row's, else the first; `several` when files are checked in more than one.
 */
export function amendTarget(
  groups: readonly SourceControlGroup[],
  checked: ReadonlySet<string>,
  selectedRoot: string | null
): CommitWork | 'several' | null {
  const targets = checkedFilesByGroup(groups, checked, trackedFiles)
  if (targets.length > 1) return 'several'
  if (targets[0]) return targets[0]
  const git = gitGroups(groups)
  const group = git.find((each) => each.root === selectedRoot) ?? git[0]
  return group ? { group, files: [] } : null
}

/** Each operation as the commit box speaks of it. */
const OPERATION_NAMES: Record<GitOperation, string> = {
  merge: 'merge',
  'cherry-pick': 'cherry-pick',
  revert: 'revert',
  rebase: 'rebase'
}

/**
 * What Commit works on now: each group with checked files, or Amend's one group. `blocked` says
 * why it can't run; `note` what committing does beyond the checked files.
 */
export function commitPlan(
  groups: readonly SourceControlGroup[],
  checked: ReadonlySet<string>,
  selectedRoot: string | null,
  amend: boolean
): { work: CommitWork[]; blocked: string | null; note: string | null } {
  const target = amend ? amendTarget(groups, checked, selectedRoot) : null
  if (target === 'several')
    return {
      work: [],
      blocked: 'Amend works on one repository at a time: check files in only one',
      note: null
    }
  const work = amend ? (target ? [target] : []) : checkedFilesByGroup(groups, checked, trackedFiles)
  const rebasing = work.find(({ group }) => group.operation === 'rebase')
  if (rebasing)
    return {
      work: [],
      blocked: `A rebase is in progress in ${rebasing.group.name}: finish it in a terminal`,
      note: null
    }
  const concluding = work.filter(({ group }) => group.operation !== null)
  const note =
    concluding
      .map(({ group }) => {
        const operation = OPERATION_NAMES[group.operation ?? 'merge']
        return `Committing concludes the ${operation} in ${group.name} and includes everything the ${operation} already staged.`
      })
      .join(' ') || null
  return { work, blocked: null, note }
}

/** Why `git pull` can't run in the group, as the group menu shows it, or null when it can. */
export function pullBlocker(group: GitGroup): string | null {
  if (group.branch === null) return 'Detached HEAD'
  if (group.upstream === null) return 'No upstream'
  return null
}

const nameList = (groups: GitGroup[]): string => groups.map((group) => group.name).join(', ')

/**
 * What the header's Pull pulls: the chosen (or only) working tree, else every one that can be
 * pulled, in order. `blocked` says why nothing can be; `tip` says what it does.
 */
export function pullPlan(
  groups: readonly SourceControlGroup[] | null,
  chosenRoot: string | null
): { targets: GitGroup[]; blocked: string | null; tip: string } {
  const git = gitGroups(groups)
  const chosen =
    git.find((group) => group.root === chosenRoot) ?? (git.length === 1 ? git[0] : undefined)
  if (chosen) {
    const blocked = pullBlocker(chosen)
    return blocked === null
      ? { targets: [chosen], blocked: null, tip: `Pull ${chosen.name}` }
      : {
          targets: [],
          blocked:
            chosen.branch === null
              ? `${chosen.name} has a detached HEAD: nothing to pull into`
              : `${chosen.name} has no upstream branch to pull from`,
          tip: ''
        }
  }
  const targets = git.filter((group) => pullBlocker(group) === null)
  if (targets.length === 0)
    return {
      targets,
      blocked:
        git.length === 0
          ? 'No git repository to pull'
          : 'No repository has an upstream branch to pull from',
      tip: ''
    }
  const skipped = git.filter((group) => !targets.includes(group))
  return {
    targets,
    blocked: null,
    tip:
      skipped.length === 0
        ? 'Pull every repository, one after another'
        : `Pull ${nameList(targets)}, one after another; ${nameList(skipped)} can't be pulled`
  }
}
