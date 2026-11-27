import { create } from 'zustand'
import {
  addableFiles,
  fileKey,
  type GitGroup,
  keepListedChecks,
  toggleFilesChecks,
  trackedFiles
} from '@/components/git/change-tree-rows'
import {
  amendTarget,
  commitPlan,
  concludesOperation,
  gitGroups,
  pullPlan
} from '@/components/git/commit-plan'
import { mainErrorMessage } from '@/lib/main-error-message'
import type {
  ChangedFile,
  GitOutcome,
  SourceControlGroup
} from '../../../shared/source-control-api'

/** What the Commit panel is doing; its button spins and every other action waits. */
export type SourceControlAction =
  | 'refresh'
  | 'commit'
  | 'commit-push'
  | 'fetch'
  | 'pull'
  | 'push'
  | 'rollback'
  | 'add'
  | 'ignore'
  | 'abort'

/** Files of one working tree an action works on. */
export type FileTargets = { group: GitGroup; files: ChangedFile[] }[]

/** A failed action: which one and where, and what git (or a hook) printed, unedited. */
/** What the last action printed when it failed, or was cancelled (not an error: shown plainly). */
export type ActionFailure = { title: string; output: string; cancelled?: true }

type SourceControlState = {
  /** Every working tree of the workspace with its changes; null until first read. */
  groups: SourceControlGroup[] | null
  /** Tracked changes to commit or roll back, by `fileKey`; new changes start unchecked. */
  checked: ReadonlySet<string>
  /** Untracked files to add to version control, by `fileKey`: never committed as they are. */
  toAdd: ReadonlySet<string>
  /** Roots whose files are folded away. */
  collapsed: ReadonlySet<string>
  /** Roots whose Unversioned Files row is unfolded; it starts folded. */
  unversionedOpen: ReadonlySet<string>
  /** The tree's selected row and the working tree it belongs to: Pull acts on that one. */
  selected: { key: string; root: string } | null
  running: SourceControlAction | null
  /** Cancel was asked for the running action: it stops after the git command now running. */
  cancelling: boolean
  failure: ActionFailure | null
  message: string
  amend: boolean
  /**
   * Text the app put in the empty box, whose and from where: Amend's last commit message, or the
   * message git prepared for concluding an operation. It follows its source while untouched.
   */
  filled: { root: string; message: string; by: 'amend' | 'operation' } | null
  /**
   * Reads every group's status again; quietly unless `shown`, which spins Refresh. Reads asked
   * for while one runs share a single read after it.
   */
  refresh: (shown?: boolean) => Promise<void>
  /** Checks or unchecks a tracked change for the commit. */
  toggleFile: (root: string, path: string) => void
  /** Checks or unchecks an untracked file to add. */
  toggleToAdd: (root: string, path: string) => void
  /** The group's tracked changes, all checked or all unchecked. */
  toggleGroup: (group: GitGroup) => void
  /** The group's untracked files, all checked to add or none. */
  toggleUnversioned: (group: GitGroup) => void
  /** Checks only this change, in every group, for Commit File…. */
  checkOnly: (root: string, path: string) => void
  toggleFold: (root: string) => void
  toggleUnversionedFold: (root: string) => void
  expandAll: () => void
  collapseAll: () => void
  select: (key: string, root: string) => void
  setMessage: (message: string) => void
  setAmend: (amend: boolean) => Promise<void>
  /**
   * Commits the checked files of each group in turn with the message, pushing each after it when
   * `push`; with Amend, only its one group.
   */
  commit: (push: boolean) => Promise<void>
  /** Pulls `root`, else the selected row's working tree, the only git one, or else every one that can be pulled, in turn. */
  pull: (root?: string) => Promise<void>
  push: (group: GitGroup) => Promise<void>
  fetch: (group: GitGroup) => Promise<void>
  /** Rolls tracked changes back to the last commit. */
  rollback: (targets: FileTargets) => Promise<void>
  /** Adds untracked files to version control; they are then listed as added, unchecked. */
  addToVcs: (group: GitGroup, files: ChangedFile[]) => Promise<void>
  /** Ignores an untracked file in its root's .gitignore. */
  ignore: (group: GitGroup, file: ChangedFile) => Promise<void>
  /** Aborts the group's merge, cherry-pick, revert or rebase. */
  abort: (group: GitGroup) => Promise<void>
  /** Stops the running commit, push, pull, fetch, rollback, add or abort, with its hooks and ssh. */
  cancel: () => Promise<void>
  dismissFailure: () => void
}

/** The working tree Amend works on now, if just one. */
function amendRoot(state: SourceControlState): GitGroup | null {
  const target = amendTarget(state.groups ?? [], state.checked, state.selected?.root ?? null)
  return target === null || target === 'several' ? null : target.group
}

/** Whether the box holds nothing the user wrote: empty, or the app's own text left as it was. */
const untouched = (state: SourceControlState): boolean =>
  state.filled === null ? state.message.trim() === '' : state.message === state.filled.message

/** The message git prepared for the operation Commit concludes, when it commits in that repository only. */
function operationMessage(state: SourceControlState): { root: string; message: string } | null {
  const { work } = commitPlan(
    state.groups ?? [],
    state.checked,
    state.selected?.root ?? null,
    false
  )
  // A commit in another repository as well would carry the merge's message there too.
  const [only] = work
  const message = only?.group.operation?.message
  return work.length === 1 && only && concludesOperation(only.group) && message
    ? { root: only.group.root, message }
    : null
}

/** Conflicted files of merges, cherry-picks and reverts: they can't be left out of the commit that concludes one. */
const conflictKeys = (groups: readonly SourceControlGroup[]): string[] =>
  gitGroups(groups)
    .filter(concludesOperation)
    .flatMap((group) =>
      group.files
        .filter((file) => file.kind === 'conflicted')
        .map((file) => fileKey(group.root, file.path))
    )

const toggled = (keys: ReadonlySet<string>, key: string): Set<string> => {
  const next = new Set(keys)
  if (!next.delete(key)) next.add(key)
  return next
}

export const useSourceControlStore = create<SourceControlState>((set, get, store) => {
  let reading: Promise<void> | null = null
  let queued: Promise<void> | null = null

  /** One status read at a time, and at most one more after it, which then speaks for every later ask. */
  const readStatus = (): Promise<void> => {
    if (queued) return queued
    if (reading) {
      queued = reading.then(() => {
        queued = null
        return readStatus()
      })
      return queued
    }
    reading = (async () => {
      try {
        const groups = await window.desktop.getSourceControlStatus()
        // A read asked for meanwhile follows at once and has the newer word.
        if (queued) return
        set((state) => {
          // A file that just became conflicted starts checked; unchecking it later is the user's call.
          const before = new Set(conflictKeys(state.groups ?? []))
          const conflicted = conflictKeys(groups).filter((key) => !before.has(key))
          const checked =
            conflicted.length === 0 ? state.checked : new Set([...state.checked, ...conflicted])
          return {
            groups,
            checked: keepListedChecks(checked, groups, trackedFiles),
            toAdd: keepListedChecks(state.toAdd, groups, addableFiles)
          }
        })
      } catch (error) {
        if (!queued)
          set({ failure: { title: 'Reading the changes failed', output: mainErrorMessage(error) } })
      }
    })().finally(() => {
      reading = null
    })
    return reading
  }

  /**
   * Fills the box with the last commit message of Amend's target while the box holds nothing the
   * user wrote, again whenever the target changes; never with files checked in several groups.
   */
  const fillAmend = async (): Promise<void> => {
    const state = get()
    const group = amendRoot(state)
    if (
      !state.amend ||
      group === null ||
      (state.filled?.by === 'amend' && state.filled.root === group.root) ||
      !untouched(state)
    )
      return
    try {
      const last = await window.desktop.getLastCommitMessage(group.root)
      // The user may have typed, turned Amend off or changed its target while it was read.
      const now = get()
      if (
        last !== null &&
        now.amend &&
        now.message === state.message &&
        amendRoot(now)?.root === group.root
      )
        set({ message: last, filled: { root: group.root, message: last, by: 'amend' } })
    } catch (error) {
      set({
        failure: {
          title: `Reading the last commit failed in ${group.name}`,
          output: mainErrorMessage(error)
        }
      })
    }
  }

  /**
   * Runs an action with its button spinning and the last failure cleared; the first failure, or
   * any error main throws, is kept for the panel to show. Status is read again afterwards.
   */
  const act = async (
    action: SourceControlAction,
    steps: (fail: (what: string, name: string, outcome: GitOutcome) => boolean) => Promise<void>,
    title: () => string
  ): Promise<void> => {
    if (get().running) return
    set({ running: action, cancelling: false, failure: null })
    const fail = (what: string, name: string, outcome: GitOutcome): boolean => {
      if (outcome.ok) return false
      const cancelled = outcome.cancelled === true
      set({
        failure: {
          title: `${what} ${cancelled ? 'cancelled' : 'failed'} in ${name}`,
          output: outcome.output,
          ...(cancelled ? { cancelled: true } : {})
        }
      })
      return true
    }
    try {
      await steps(fail)
    } catch (error) {
      set({ failure: { title: title(), output: mainErrorMessage(error) } })
    } finally {
      set({ running: null, cancelling: false })
    }
    await get().refresh()
  }

  /**
   * Puts the message git prepared for the operation Commit concludes in the box while it holds
   * nothing the user wrote, and takes it out again once no operation is to be concluded.
   */
  const fillOperation = (): void => {
    const state = get()
    if (state.amend || !untouched(state)) return
    const prepared = operationMessage(state)
    if (prepared === null) {
      if (state.filled?.by === 'operation') set({ message: '', filled: null })
      return
    }
    if (state.filled?.root !== prepared.root || state.filled.message !== prepared.message)
      set({ message: prepared.message, filled: { ...prepared, by: 'operation' } })
  }

  // The box's text follows its source: files checked elsewhere, another row selected, files gone.
  store.subscribe((state, previous) => {
    if (
      state.checked !== previous.checked ||
      state.selected !== previous.selected ||
      state.groups !== previous.groups ||
      state.amend !== previous.amend
    )
      if (state.amend) void fillAmend()
      else fillOperation()
  })

  const uncheck = (root: string, files: ChangedFile[]): void =>
    set((state) => {
      const checked = new Set(state.checked)
      const toAdd = new Set(state.toAdd)
      for (const file of files) {
        checked.delete(fileKey(root, file.path))
        toAdd.delete(fileKey(root, file.path))
      }
      return { checked, toAdd }
    })

  /** Runs one git command for one working tree, its failure titled "<what> failed in <name>". */
  const actOn = (
    action: SourceControlAction,
    what: string,
    group: GitGroup,
    run: () => Promise<GitOutcome>
  ): Promise<void> =>
    act(
      action,
      async (fail) => {
        fail(what, group.name, await run())
      },
      () => `${what} failed in ${group.name}`
    )

  return {
    groups: null,
    checked: new Set(),
    toAdd: new Set(),
    collapsed: new Set(),
    unversionedOpen: new Set(),
    selected: null,
    running: null,
    cancelling: false,
    failure: null,
    message: '',
    amend: false,
    filled: null,
    refresh: async (shown = false) => {
      if (shown) {
        if (get().running) return
        set({ running: 'refresh', failure: null })
      }
      try {
        await readStatus()
      } finally {
        if (shown) set({ running: null })
      }
    },
    toggleFile: (root, path) =>
      set((state) => ({ checked: toggled(state.checked, fileKey(root, path)) })),
    toggleToAdd: (root, path) =>
      set((state) => ({ toAdd: toggled(state.toAdd, fileKey(root, path)) })),
    toggleGroup: (group) =>
      set((state) => ({
        checked: toggleFilesChecks(group.root, trackedFiles(group), state.checked)
      })),
    toggleUnversioned: (group) =>
      set((state) => ({
        toAdd: toggleFilesChecks(group.root, addableFiles(group), state.toAdd)
      })),
    checkOnly: (root, path) => set({ checked: new Set([fileKey(root, path)]) }),
    toggleFold: (root) => set((state) => ({ collapsed: toggled(state.collapsed, root) })),
    toggleUnversionedFold: (root) =>
      set((state) => ({ unversionedOpen: toggled(state.unversionedOpen, root) })),
    expandAll: () =>
      set((state) => ({
        collapsed: new Set(),
        unversionedOpen: new Set(gitGroups(state.groups).map((group) => group.root))
      })),
    collapseAll: () =>
      set((state) => ({
        collapsed: new Set((state.groups ?? []).map((group) => group.root)),
        unversionedOpen: new Set()
      })),
    select: (key, root) => set({ selected: { key, root } }),
    setMessage: (message) => set({ message }),
    setAmend: async (amend) => {
      if (amend) {
        set({ amend: true })
        await fillAmend()
        return
      }
      // Amend's own text goes with it; anything the user wrote stays.
      set((state) =>
        state.filled?.by === 'amend'
          ? { amend: false, filled: null, message: untouched(state) ? '' : state.message }
          : { amend: false }
      )
    },
    commit: async (push) => {
      const { groups, checked, selected, message, amend } = get()
      const { work, blocked } = commitPlan(groups ?? [], checked, selected?.root ?? null, amend)
      if (message.trim() === '' || work.length === 0 || blocked !== null) return
      let current = work[0]?.group.name ?? ''
      await act(
        push ? 'commit-push' : 'commit',
        async (fail) => {
          // The message has served its purpose once every group has its commit, even if the last push failed.
          let committed = 0
          for (const { group, files } of work) {
            if (get().cancelling) break
            current = group.name
            const outcome = await window.desktop.commitChanges({
              root: group.root,
              paths: files.map((file) => file.path),
              message,
              amend
            })
            if (fail('Commit', group.name, outcome)) break
            committed += 1
            uncheck(group.root, files)
            if (
              push &&
              !get().cancelling &&
              fail('Push', group.name, await window.desktop.pushBranch(group.root))
            )
              break
          }
          if (committed === work.length) set({ message: '', amend: false, filled: null })
        },
        () => `${push ? 'Commit and Push' : 'Commit'} failed in ${current}`
      )
    },
    pull: async (root) => {
      const { targets } = pullPlan(get().groups, root ?? get().selected?.root ?? null)
      if (targets.length === 0) return
      let current = targets[0]?.name ?? ''
      await act(
        'pull',
        async (fail) => {
          for (const group of targets) {
            if (get().cancelling) break
            current = group.name
            if (fail('Pull', group.name, await window.desktop.pullBranch(group.root))) break
          }
        },
        () => `Pull failed in ${current}`
      )
    },
    push: (group) => actOn('push', 'Push', group, () => window.desktop.pushBranch(group.root)),
    fetch: (group) => actOn('fetch', 'Fetch', group, () => window.desktop.fetchRemote(group.root)),
    addToVcs: async (group, files) => {
      if (files.length === 0) return
      await actOn('add', 'Add', group, async () => {
        const outcome = await window.desktop.addUntrackedFiles(
          group.root,
          files.map((file) => file.path)
        )
        if (outcome.ok) uncheck(group.root, files)
        return outcome
      })
    },
    ignore: (group, file) =>
      actOn('ignore', 'Add to .gitignore', group, async () => {
        await window.desktop.ignoreUntrackedFile(group.root, file.path)
        return { ok: true, output: '' }
      }),
    rollback: async (targets) => {
      let current = targets[0]?.group.name ?? ''
      await act(
        'rollback',
        async (fail) => {
          for (const { group, files } of targets) {
            if (get().cancelling) break
            current = group.name
            const outcome = await window.desktop.rollbackChanges(
              group.root,
              files.map((file) => file.path)
            )
            if (fail('Rollback', group.name, outcome)) break
            uncheck(group.root, files)
          }
        },
        () => `Rollback failed in ${current}`
      )
    },
    abort: async (group) => {
      const { operation } = group
      if (operation === null) return
      await actOn('abort', 'Abort', group, () =>
        window.desktop.abortGitOperation(group.root, operation.kind)
      )
    },
    cancel: async () => {
      const { running, cancelling } = get()
      if (running === null || running === 'refresh' || cancelling) return
      set({ cancelling: true })
      await window.desktop.cancelSourceControlAction()
    },
    dismissFailure: () => set({ failure: null })
  }
})
