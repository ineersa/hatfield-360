import type { ChangedFile, SourceControlGroup } from '../../../../shared/source-control-api'
import {
  addableFiles,
  checkedFilesByGroup,
  fileKey,
  type GitGroup,
  trackedFiles
} from './change-tree-rows'
import { OPERATION_NAMES } from './operation-notice'

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

/** A merge, cherry-pick or revert a commit concludes in the group; a rebase is finished in a terminal. */
export const concludesOperation = (group: GitGroup): boolean =>
  group.operation !== null && group.operation.kind !== 'rebase'

/**
 * What Commit works on now: each group with checked files, or Amend's one group; with nothing
 * checked, the one group whose merge, cherry-pick or revert a commit would conclude. `blocked`
 * says why it can't run; `note` names the repository whose operation it concludes when the
 * workspace has several.
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
  if (target?.group.operation)
    return {
      work: [],
      blocked: `Amend isn't available during the ${OPERATION_NAMES[target.group.operation.kind].noun} in ${target.group.name}`,
      note: null
    }
  const checkedWork = checkedFilesByGroup(groups, checked, trackedFiles)
  const concludable = gitGroups(groups).filter(concludesOperation)
  const work = amend
    ? target
      ? [target]
      : []
    : checkedWork.length === 0 && concludable.length === 1 && concludable[0]
      ? [{ group: concludable[0], files: [] }]
      : checkedWork
  const rebasing = work.find(({ group }) => group.operation?.kind === 'rebase')
  if (rebasing)
    return {
      work: [],
      blocked: `A rebase is in progress in ${rebasing.group.name}: finish it in a terminal`,
      note: null
    }
  const concluding = work.filter(({ group }) => concludesOperation(group))
  const note =
    gitGroups(groups).length > 1
      ? concluding
          .map(
            ({ group }) =>
              `Concludes the ${OPERATION_NAMES[group.operation?.kind ?? 'merge'].noun} in ${group.name}.`
          )
          .join(' ') || null
      : null
  return { work, blocked: null, note }
}

/**
 * The Commit button's label: what it does when it concludes one group's merge or revert. A
 * cherry-pick keeps the plain label, whose longer name wouldn't fit beside Commit and Push.
 */
export function commitLabel(work: readonly CommitWork[]): string {
  const [only] = work
  if (work.length !== 1 || only === undefined) return 'Commit'
  const kind = only.group.operation?.kind
  return kind === 'merge' ? 'Commit Merge' : kind === 'revert' ? 'Commit Revert' : 'Commit'
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

/**
 * The repository and files a generated message describes, as Commit would take them: one
 * repository's checked files, or with Amend its last commit and any checked files; `blocked`
 * says why there is none.
 */
export function generatePlan(
  groups: readonly SourceControlGroup[],
  checked: ReadonlySet<string>,
  selectedRoot: string | null,
  amend: boolean,
  actionRunning: boolean
): { target: CommitWork | null; blocked: string | null } {
  // A commit or another git action would change what the message describes under it.
  if (actionRunning) return { target: null, blocked: 'Wait for the current action to finish' }
  const targets = amend
    ? [amendTarget(groups, checked, selectedRoot)]
    : checkedFilesByGroup(groups, checked, trackedFiles)
  const [target] = targets
  if (targets.length > 1 || target === 'several')
    return {
      target: null,
      blocked: 'Generate works on one repository at a time: check files in only one'
    }
  if (target === undefined || target === null)
    return { target: null, blocked: 'Check the files the message is for' }
  return { target, blocked: null }
}

const chosen = (keys: ReadonlySet<string>, group: GitGroup, files: ChangedFile[]): ChangedFile[] =>
  files.filter((file) => keys.has(fileKey(group.root, file.path)))

/** What a stash takes from one working tree: its checked changes and its untracked files chosen to add. */
export type StashTarget = { group: GitGroup; files: ChangedFile[]; untracked: ChangedFile[] }

/**
 * The working tree Stash Changes works on and what it takes: `root`'s when given (its menu), else
 * the one with chosen files, the selected row's when several have some. Never everything: with
 * nothing chosen it is blocked.
 */
export function stashPlan(
  groups: readonly SourceControlGroup[],
  checked: ReadonlySet<string>,
  toAdd: ReadonlySet<string>,
  place: { root: string; only: boolean } | null
): { target: StashTarget | null; blocked: string | null } {
  const targets = gitGroups(groups)
    .filter((group) => place === null || !place.only || group.root === place.root)
    .map((group) => ({
      group,
      files: chosen(checked, group, trackedFiles(group)),
      untracked: chosen(toAdd, group, addableFiles(group))
    }))
    .filter((target) => target.files.length > 0 || target.untracked.length > 0)
  const target = targets.find((each) => each.group.root === place?.root) ?? targets[0] ?? null
  return target === null
    ? { target: null, blocked: 'Check the files to stash' }
    : { target, blocked: null }
}
