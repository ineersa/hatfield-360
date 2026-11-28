import { describe, expect, it } from 'vitest'
import type { GitOperationState } from '../../../../shared/source-control-api'
import type { GitGroup } from './change-tree-rows'
import { operationNotice } from './operation-notice'

const repo = (operation: GitOperationState | null, branch: string | null = 'main'): GitGroup => ({
  project: '/app',
  root: '/app',
  name: 'app',
  worktree: false,
  parent: null,
  status: 'git',
  branch,
  upstream: null,
  ahead: null,
  behind: null,
  operation,
  files: []
})

describe('operationNotice', () => {
  it('counts the conflicts left in a merge and names what is merged into what', () => {
    expect(
      operationNotice(repo({ kind: 'merge', merging: 'origin/main', message: null, conflicts: 2 }))
    ).toEqual({
      title: 'Merge in progress',
      detail: 'Merging origin/main into main.',
      status: '2 files with conflicts: resolve them, then commit.'
    })
  })

  it('says to commit once no conflicts are left, without naming a branch it does not know', () => {
    expect(
      operationNotice(
        repo({ kind: 'cherry-pick', merging: null, message: null, conflicts: 0 }, null)
      )
    ).toEqual({
      title: 'Cherry-pick in progress',
      detail: null,
      status: 'No conflicts left: commit to conclude the cherry-pick.'
    })
  })

  it('sends a rebase to the terminal, with or without conflicts', () => {
    expect(
      operationNotice(repo({ kind: 'rebase', merging: null, message: null, conflicts: 1 }))?.status
    ).toBe('1 file with conflicts: resolve it, then continue the rebase in a terminal.')
    expect(
      operationNotice(repo({ kind: 'rebase', merging: null, message: null, conflicts: 0 }))?.status
    ).toBe('Continue it in a terminal (git rebase --continue), or abort it.')
  })

  it('is null with nothing in progress', () => {
    expect(operationNotice(repo(null))).toBeNull()
  })
})
