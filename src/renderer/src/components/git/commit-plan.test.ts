import { describe, expect, it } from 'vitest'
import type { ChangedFile, GitOperation } from '../../../../shared/source-control-api'
import { fileKey, type GitGroup } from './change-tree-rows'
import { amendTarget, commitPlan, pullPlan } from './commit-plan'

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
  operation,
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

  it('says a commit concludes a merge, and leaves a rebase to the terminal', () => {
    const merging = repo('/app', { operation: 'merge' })
    const rebasing = repo('/lib', { operation: 'rebase' })

    expect(commitPlan([merging], checkedIn('/app'), null, false).note).toBe(
      'Committing concludes the merge in app and includes everything the merge already staged.'
    )
    expect(commitPlan([merging, rebasing], checkedIn('/app', '/lib'), null, false)).toEqual({
      work: [],
      blocked: 'A rebase is in progress in lib: finish it in a terminal',
      note: null
    })
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
