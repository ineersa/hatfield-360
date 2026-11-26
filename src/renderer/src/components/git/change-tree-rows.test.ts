import { describe, expect, it } from 'vitest'
import type { ChangedFile, SourceControlGroup } from '../../../../shared/source-control-api'
import {
  changeTreeRows,
  checkedFilesByGroup,
  fileKey,
  type GitGroup,
  groupCheckState,
  keepListedChecks,
  toggleGroupChecks
} from './change-tree-rows'

const file = (root: string, path: string, kind: ChangedFile['kind'] = 'modified'): ChangedFile => ({
  path,
  absolutePath: `${root}/${path}`,
  originalPath: null,
  kind
})

const repo = (root: string, paths: string[]): GitGroup => ({
  project: root,
  root,
  name: root.slice(1),
  worktree: false,
  status: 'git',
  branch: 'main',
  upstream: null,
  ahead: null,
  behind: null,
  files: paths.map((path) => file(root, path))
})

const app = repo('/app', ['a.ts', 'src/b.ts'])
const lib = repo('/lib', ['c.ts'])
const clean = repo('/clean', [])
const notes: SourceControlGroup = {
  project: '/notes',
  root: '/notes',
  name: 'notes',
  worktree: false,
  status: 'not-git'
}
const broken: SourceControlGroup = {
  project: '/broken',
  root: '/broken',
  name: 'broken',
  worktree: false,
  status: 'error',
  message: 'fatal: bad HEAD'
}

describe('changeTreeRows', () => {
  it('lists each group with its files, or the reason it has none, and folds groups away', () => {
    const rows = changeTreeRows([app, clean, notes, broken], new Set(['/notes']))
    expect(rows.map((row) => [row.type, row.key])).toEqual([
      ['group', '/app'],
      ['file', '/app\0a.ts'],
      ['file', '/app\0src/b.ts'],
      ['group', '/clean'],
      ['note', '/clean\0'],
      ['group', '/notes'],
      ['group', '/broken'],
      ['error', '/broken\0']
    ])
    expect(rows[4]).toMatchObject({ note: 'clean' })
    expect(rows[5]).toMatchObject({ expanded: false })
    expect(rows[7]).toMatchObject({ message: 'fatal: bad HEAD' })
    expect(changeTreeRows([notes], new Set())[1]).toMatchObject({ note: 'not-git' })
  })
})

describe('group checks', () => {
  it('reads unchecked, mixed and checked from the files checked', () => {
    expect(groupCheckState(app, new Set())).toBe('unchecked')
    expect(groupCheckState(app, new Set(['/app\0a.ts']))).toBe('mixed')
    expect(groupCheckState(app, new Set(['/app\0a.ts', '/app\0src/b.ts']))).toBe('checked')
  })

  it('checks every file of a partly checked group, and unchecks a fully checked one, leaving others', () => {
    const partly = new Set(['/app\0a.ts', '/lib\0c.ts'])
    const all = toggleGroupChecks(app, partly)
    expect([...all].toSorted()).toEqual(['/app\0a.ts', '/app\0src/b.ts', '/lib\0c.ts'])
    expect([...toggleGroupChecks(app, all)]).toEqual(['/lib\0c.ts'])
  })
})

describe('keepListedChecks', () => {
  it('drops checks of files no longer listed and keeps the same set when nothing went away', () => {
    const checked = new Set([fileKey('/app', 'a.ts'), fileKey('/app', 'gone.ts'), '/notes\0x'])
    expect([...keepListedChecks(checked, [app, notes])]).toEqual(['/app\0a.ts'])
    const kept = new Set(['/app\0a.ts'])
    expect(keepListedChecks(kept, [app])).toBe(kept)
  })
})

describe('checkedFilesByGroup', () => {
  it('names the groups with checked files in workspace order, each with its checked files', () => {
    const result = checkedFilesByGroup(
      [notes, app, clean, lib],
      new Set(['/lib\0c.ts', '/app\0src/b.ts'])
    )
    expect(result.map(({ group, files }) => [group.root, files.map((each) => each.path)])).toEqual([
      ['/app', ['src/b.ts']],
      ['/lib', ['c.ts']]
    ])
  })
})
