import { describe, expect, it } from 'vitest'
import type { ChangedFile, GitOperation } from '../../../../shared/source-control-api'
import { fileKey, type GitGroup } from './change-tree-rows'
import {
  amendTarget,
  commitLabel,
  commitPlan,
  generatePlan,
  pullPlan,
  stashPlan
} from './commit-plan'

const file = (root: string, path: string): ChangedFile => ({
  path,
  absolutePath: `${root}/${path}`,
  originalPath: null,
  kind: 'modified',
  nestedRepository: false
})

const repo = (
  root: string,
  {
    upstream = 'origin/main',
    operation = null
  }: { upstream?: string | null; operation?: GitOperation | null } = {}
): GitGroup => ({
  project: root,
  root,
  name: root.slice(1),
  worktree: false,
  status: 'git',
  branch: 'main',
  upstream,
  ahead: upstream === null ? null : 0,
  behind: upstream === null ? null : 0,
  operation:
    operation === null ? null : { kind: operation, merging: null, message: null, conflicts: 0 },
  files: [file(root, 'a.ts')]
})

const checkedIn = (...roots: string[]): Set<string> =>
  new Set(roots.map((root) => fileKey(root, 'a.ts')))

describe('amendTarget', () => {
  const groups = [repo('/app'), repo('/lib')]

  it('is the one group with checked files, else the selected row’s, and several when files are checked in two', () => {
    expect(amendTarget(groups, checkedIn('/lib'), '/app')).toMatchObject({
      group: { root: '/lib' },
      files: [{ path: 'a.ts' }]
    })
    expect(amendTarget(groups, new Set(), '/lib')).toMatchObject({
      group: { root: '/lib' },
      files: []
    })
    expect(amendTarget(groups, checkedIn('/app', '/lib'), null)).toBe('several')
  })
})

describe('generatePlan', () => {
  const groups = [repo('/app'), repo('/lib')]

  it('describes one repository’s checked files, or with Amend its last commit even with none checked', () => {
    expect(generatePlan(groups, checkedIn('/lib'), '/app', false, false)).toMatchObject({
      target: { group: { root: '/lib' }, files: [{ path: 'a.ts' }] },
      blocked: null
    })
    expect(generatePlan(groups, new Set(), '/lib', false, false)).toEqual({
      target: null,
      blocked: 'Check the files the message is for'
    })
    expect(generatePlan(groups, new Set(), '/lib', true, false)).toMatchObject({
      target: { group: { root: '/lib' }, files: [] },
      blocked: null
    })
    for (const amend of [false, true])
      expect(generatePlan(groups, checkedIn('/app', '/lib'), null, amend, false)).toEqual({
        target: null,
        blocked: 'Generate works on one repository at a time: check files in only one'
      })
  })

  it('waits while a commit or another git action runs', () => {
    expect(generatePlan(groups, checkedIn('/lib'), '/lib', false, true)).toEqual({
      target: null,
      blocked: 'Wait for the current action to finish'
    })
  })
})

describe('commitPlan', () => {
  it('blocks Amend with files checked in two repositories, and commits each checked group without it', () => {
    const groups = [repo('/app'), repo('/lib')]

    expect(commitPlan(groups, checkedIn('/app', '/lib'), null, true)).toEqual({
      work: [],
      blocked: 'Amend works on one repository at a time: check files in only one',
      note: null
    })
    expect(
      commitPlan(groups, checkedIn('/app', '/lib'), null, false).work.map(({ group }) => group.root)
    ).toEqual(['/app', '/lib'])
  })

  it('names the repository whose merge a commit concludes, and leaves a rebase to the terminal', () => {
    const merging = repo('/app', { operation: 'merge' })
    const rebasing = repo('/lib', { operation: 'rebase' })

    expect(commitPlan([merging, repo('/lib')], checkedIn('/app'), null, false).note).toBe(
      'Concludes the merge in app.'
    )
    expect(commitPlan([merging], checkedIn('/app'), null, false).note).toBeNull()
    expect(commitPlan([merging, rebasing], checkedIn('/app', '/lib'), null, false)).toEqual({
      work: [],
      blocked: 'A rebase is in progress in lib: finish it in a terminal',
      note: null
    })
  })

  it('concludes the one merge in progress with nothing checked, but not one of two', () => {
    const merging = repo('/app', { operation: 'merge' })

    expect(commitPlan([merging, repo('/lib')], new Set(), null, false).work).toEqual([
      { group: merging, files: [] }
    ])
    expect(
      commitPlan([merging, repo('/lib', { operation: 'revert' })], new Set(), null, false).work
    ).toEqual([])
  })

  it('blocks Amend on a repository in the middle of a merge', () => {
    expect(commitPlan([repo('/app', { operation: 'merge' })], new Set(), null, true)).toEqual({
      work: [],
      blocked: "Amend isn't available during the merge in app",
      note: null
    })
  })
})

describe('commitLabel', () => {
  it('says Commit Merge when it concludes one merge, and Commit otherwise', () => {
    const merging = repo('/app', { operation: 'merge' })

    expect(commitLabel([{ group: merging, files: [] }])).toBe('Commit Merge')
    expect(commitLabel([{ group: repo('/app', { operation: 'cherry-pick' }), files: [] }])).toBe(
      'Commit'
    )
    expect(
      commitLabel([
        { group: merging, files: [] },
        { group: repo('/lib'), files: [] }
      ])
    ).toBe('Commit')
  })
})

describe('pullPlan', () => {
  it('pulls every repository that can be pulled, skipping one without an upstream', () => {
    const plan = pullPlan([repo('/app'), repo('/lib', { upstream: null }), repo('/web')], null)

    expect(plan.targets.map((group) => group.root)).toEqual(['/app', '/web'])
    expect(plan.tip).toBe("Pull app, web, one after another; lib can't be pulled")
  })

  it('is blocked when nothing can be pulled, or the chosen repository has no upstream', () => {
    const groups = [repo('/app', { upstream: null }), repo('/lib', { upstream: null })]

    expect(pullPlan(groups, null)).toMatchObject({
      targets: [],
      blocked: 'No repository has an upstream branch to pull from'
    })
    expect(pullPlan([repo('/app'), ...groups.slice(1)], '/lib')).toMatchObject({
      targets: [],
      blocked: 'lib has no upstream branch to pull from'
    })
  })
})

describe('stashPlan', () => {
  const untracked = (root: string, path: string): ChangedFile => ({
    ...file(root, path),
    kind: 'untracked'
  })
  const app = { ...repo('/app'), files: [file('/app', 'a.ts'), untracked('/app', 'new.ts')] }
  const groups = [app, repo('/lib')]

  it('takes the checked changes and chosen untracked files of one repository, the selected one when several have some', () => {
    const toAdd = new Set([fileKey('/app', 'new.ts')])
    expect(stashPlan(groups, checkedIn('/app'), toAdd, null)).toMatchObject({
      target: {
        group: { root: '/app' },
        files: [{ path: 'a.ts' }],
        untracked: [{ path: 'new.ts' }]
      },
      blocked: null
    })
    // Untracked files only are enough.
    expect(stashPlan(groups, new Set(), toAdd, null)).toMatchObject({
      target: { files: [], untracked: [{ path: 'new.ts' }] }
    })
    expect(
      stashPlan(groups, checkedIn('/app', '/lib'), new Set(), { root: '/lib', only: false })
    ).toMatchObject({ target: { group: { root: '/lib' } } })
    // The selected row's repository has nothing chosen: the one that does.
    expect(
      stashPlan(groups, checkedIn('/lib'), new Set(), { root: '/app', only: false })
    ).toMatchObject({
      target: { group: { root: '/lib' } }
    })
  })

  it('from a repository’s menu takes only that repository, and is blocked with nothing chosen', () => {
    expect(stashPlan(groups, checkedIn('/lib'), new Set(), { root: '/app', only: true })).toEqual({
      target: null,
      blocked: 'Check the files to stash'
    })
    // Unchosen untracked files are never taken.
    expect(stashPlan(groups, new Set(), new Set(), null)).toEqual({
      target: null,
      blocked: 'Check the files to stash'
    })
  })
})
