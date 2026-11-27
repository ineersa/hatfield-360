import { create } from 'zustand'
import {
  checkedFilesByGroup,
  fileKey,
  type GitGroup,
  keepListedChecks,
  toggleFilesChecks,
  trackedFiles,
  untrackedFiles
} from '@/components/git/change-tree-rows'
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

/** Files of one working tree an action works on. */
export type FileTargets = { group: GitGroup; files: ChangedFile[] }[]

/** A failed action: which one and where, and what git (or a hook) printed, unedited. */
export type ActionFailure = { title: string; output: string }

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
  failure: ActionFailure | null
  message: string
  amend: boolean
  /** What the box held before Amend filled it with the last commit's message. */
  beforeAmend: string | null
  /** Reads every group's status again; quietly unless `shown`, which spins Refresh. */
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
  /** Commits the checked files of each group in turn with the message, pushing each after it when `push`. */
  commit: (push: boolean) => Promise<void>
  /** Pulls `root`, else the selected row's working tree, the only git one, or else every git one in turn. */
  pull: (root?: string) => Promise<void>
  push: (group: GitGroup) => Promise<void>
  fetch: (group: GitGroup) => Promise<void>
  /** Rolls tracked changes back to the last commit. */
  rollback: (targets: FileTargets) => Promise<void>
  /** Adds untracked files to version control; they are then listed as added, unchecked. */
  addToVcs: (group: GitGroup, files: ChangedFile[]) => Promise<void>
  /** Ignores an untracked file in its root's .gitignore. */
  ignore: (group: GitGroup, file: ChangedFile) => Promise<void>
  dismissFailure: () => void
}

const gitGroups = (groups: SourceControlGroup[] | null): GitGroup[] =>
  (groups ?? []).filter((group): group is GitGroup => group.status === 'git')

/** The working tree whose last commit Amend replaces when no file is checked. */
function amendGroup(state: SourceControlState): GitGroup | undefined {
  return (
    checkedFilesByGroup(state.groups ?? [], state.checked, trackedFiles)[0]?.group ??
    gitGroups(state.groups)[0]
  )
}

const toggled = (keys: ReadonlySet<string>, key: string): Set<string> => {
  const next = new Set(keys)
  if (!next.delete(key)) next.add(key)
  return next
}

let latestRead = 0

export const useSourceControlStore = create<SourceControlState>((set, get) => {
  /**
   * Runs an action with its button spinning and the last failure cleared; the first failure, or
   * any error main throws, is kept for the panel to show. Status is read again afterwards.
   */
  const act = async (
    action: SourceControlAction,
    steps: (fail: (title: string, outcome: GitOutcome) => boolean) => Promise<void>,
    title: () => string
  ): Promise<void> => {
    if (get().running) return
    set({ running: action, failure: null })
    const fail = (failed: string, outcome: GitOutcome): boolean => {
      if (outcome.ok) return false
      set({ failure: { title: failed, output: outcome.output } })
      return true
    }
    try {
      await steps(fail)
    } catch (error) {
      set({ failure: { title: title(), output: mainErrorMessage(error) } })
    } finally {
      set({ running: null })
    }
    await get().refresh()
  }

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
        fail(`${what} failed in ${group.name}`, await run())
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
    failure: null,
    message: '',
    amend: false,
    beforeAmend: null,
    refresh: async (shown = false) => {
      if (shown) {
        if (get().running) return
        set({ running: 'refresh', failure: null })
      }
      const read = ++latestRead
      try {
        const groups = await window.desktop.getSourceControlStatus()
        // A later read (after an action) wins over one that was already under way.
        if (read === latestRead)
          set((state) => ({
            groups,
            checked: keepListedChecks(state.checked, groups, trackedFiles),
            toAdd: keepListedChecks(state.toAdd, groups, untrackedFiles)
          }))
      } catch (error) {
        if (read === latestRead)
          set({ failure: { title: 'Reading the changes failed', output: mainErrorMessage(error) } })
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
        toAdd: toggleFilesChecks(group.root, untrackedFiles(group), state.toAdd)
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
      const state = get()
      if (!amend) {
        set({ amend: false, beforeAmend: null, message: state.beforeAmend ?? state.message })
        return
      }
      if (state.message.trim() !== '') {
        set({ amend: true, beforeAmend: null })
        return
      }
      set({ amend: true, beforeAmend: state.message })
      const group = amendGroup(state)
      if (!group) return
      try {
        const last = await window.desktop.getLastCommitMessage(group.root)
        // The user may have typed, or turned Amend off, while it was read.
        const now = get()
        if (last !== null && now.amend && now.beforeAmend !== null && now.message === state.message)
          set({ message: last })
      } catch (error) {
        set({
          failure: {
            title: `Reading the last commit failed in ${group.name}`,
            output: mainErrorMessage(error)
          }
        })
      }
    },
    commit: async (push) => {
      const { groups, checked, message, amend } = get()
      const targets = checkedFilesByGroup(groups ?? [], checked, trackedFiles)
      const amended = amend && targets.length === 0 ? amendGroup(get()) : undefined
      const work = amended ? [{ group: amended, files: [] }] : targets
      if (message.trim() === '' || work.length === 0) return
      let current = work[0]?.group.name ?? ''
      await act(
        push ? 'commit-push' : 'commit',
        async (fail) => {
          let failed = false
          for (const { group, files } of work) {
            current = group.name
            const paths = files.map((file) => file.path)
            const outcome = await window.desktop.commitChanges({
              root: group.root,
              paths,
              message,
              amend
            })
            if (fail(`Commit failed in ${group.name}`, outcome)) {
              failed = true
              break
            }
            uncheck(group.root, files)
            if (push) {
              const pushed = await window.desktop.pushBranch(group.root)
              if (fail(`Push failed in ${group.name}`, pushed)) break
            }
          }
          if (!failed) set({ message: '', amend: false, beforeAmend: null })
        },
        () => `${push ? 'Commit and Push' : 'Commit'} failed in ${current}`
      )
    },
    pull: async (root) => {
      const { groups, selected } = get()
      const git = gitGroups(groups)
      const chosen = git.find((group) => group.root === (root ?? selected?.root))
      const targets = chosen ? [chosen] : git
      let current = targets[0]?.name ?? ''
      await act(
        'pull',
        async (fail) => {
          for (const group of targets) {
            current = group.name
            if (fail(`Pull failed in ${group.name}`, await window.desktop.pullBranch(group.root)))
              break
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
            current = group.name
            const outcome = await window.desktop.rollbackChanges(
              group.root,
              files.map((file) => file.path)
            )
            if (fail(`Rollback failed in ${group.name}`, outcome)) break
            uncheck(group.root, files)
          }
        },
        () => `Rollback failed in ${current}`
      )
    },
    dismissFailure: () => set({ failure: null })
  }
})
