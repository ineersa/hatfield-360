import { describe, expect, it } from 'vitest'
import type { ChangedFile, SourceControlGroup } from '../../../../shared/source-control-api'
import {
  changeTreeRows,
  checkedFilesByGroup,
  fileKey,
  filesCheckState,
  type GitGroup,
  keepListedChecks,
  toggleFilesChecks,
  trackedFiles,
  untrackedFiles
} from './change-tree-rows'

const file = (root: string, path: string, kind: ChangedFile['kind'] = 'modified'): ChangedFile => ({
  path,
  absolutePath: `${root}/${path}`,
  originalPath: null,
  kind,
  nestedRepository: false
})

const repo = (root: string, paths: string[], untracked: string[] = []): GitGroup => ({
  project: root,
  root,
  name: root.slice(1),
  worktree: false,
  status: 'git',
  branch: 'main',
  upstream: null,
  ahead: null,
  behind: null,
  operation: null,
  files: [
    ...paths.map((path) => file(root, path)),
    ...untracked.map((path) => file(root, path, 'untracked'))
  ]
})

const app = repo('/app', ['a.ts', 'src/b.ts'], ['new.ts', 'src/new.ts'])
const lib = repo('/lib', ['c.ts'])
const clean = repo('/clean', [])
const fresh = repo('/fresh', [], ['only.ts'])
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

const shape = (rows: ReturnType<typeof changeTreeRows>) => rows.map((row) => [row.type, row.key])

describe('changeTreeRows', () => {
  it('lists each group with its tracked changes, or the reason it has none, and folds groups away', () => {
    const rows = changeTreeRows([lib, clean, notes, broken], new Set(['/notes']), new Set())
    expect(shape(rows)).toEqual([
      ['group', '/lib'],
      ['file', '/lib\0c.ts'],
      ['group', '/clean'],
      ['note', '/clean\0'],
      ['group', '/notes'],
      ['group', '/broken'],
      ['error', '/broken\0']
    ])
    expect(rows[3]).toMatchObject({ note: 'clean' })
    expect(rows[4]).toMatchObject({ expanded: false })
    expect(rows[6]).toMatchObject({ message: 'fatal: bad HEAD' })
    expect(changeTreeRows([notes], new Set(), new Set())[1]).toMatchObject({ note: 'not-git' })
  })

  it('puts untracked files under a folded Unversioned Files row after the tracked changes', () => {
    const rows = changeTreeRows([app], new Set(), new Set())
    expect(shape(rows)).toEqual([
      ['group', '/app'],
      ['file', '/app\0a.ts'],
      ['file', '/app\0src/b.ts'],
      ['unversioned', '/app\0unversioned\0']
    ])
    expect(rows[3]).toMatchObject({ expanded: false })
    expect(rows[3]?.type === 'unversioned' && rows[3].files.map((each) => each.path)).toEqual([
      'new.ts',
      'src/new.ts'
    ])
  })

  it('lists the untracked files one level deeper once their row is unfolded', () => {
    const rows = changeTreeRows([app], new Set(), new Set(['/app']))
    expect(
      rows.slice(3).map((row) => [row.type, row.key, 'depth' in row ? row.depth : null])
    ).toEqual([
      ['unversioned', '/app\0unversioned\0', null],
      ['file', '/app\0new.ts', 2],
      ['file', '/app\0src/new.ts', 2]
    ])
    expect(rows[1]).toMatchObject({ depth: 1 })
  })

  it('puts the notice of a merge first in the group and its conflicted files before the rest', () => {
    const merging: GitGroup = {
      ...lib,
      operation: { kind: 'merge', merging: null, message: null, conflicts: 1 },
      files: [file('/lib', 'a.ts'), file('/lib', 'b.ts', 'conflicted'), file('/lib', 'c.ts')]
    }
    expect(shape(changeTreeRows([merging], new Set(), new Set()))).toEqual([
      ['group', '/lib'],
      ['operation', '/lib\0operation\0'],
      ['file', '/lib\0b.ts'],
      ['file', '/lib\0a.ts'],
      ['file', '/lib\0c.ts']
    ])
    expect(shape(changeTreeRows([merging], new Set(['/lib']), new Set()))).toEqual([
      ['group', '/lib']
    ])
  })

  it('shows only the Unversioned Files row for a group with nothing but untracked files', () => {
    expect(shape(changeTreeRows([fresh], new Set(), new Set()))).toEqual([
      ['group', '/fresh'],
      ['unversioned', '/fresh\0unversioned\0']
    ])
  })
})

describe('checks', () => {
  it('reads unchecked, mixed and checked over the files asked about only', () => {
    const tracked = trackedFiles(app)
    expect(filesCheckState('/app', tracked, new Set())).toBe('unchecked')
    // An untracked file checked to add leaves the commit side unchecked.
    expect(filesCheckState('/app', tracked, new Set(['/app\0new.ts']))).toBe('unchecked')
    expect(filesCheckState('/app', tracked, new Set(['/app\0a.ts']))).toBe('mixed')
    expect(filesCheckState('/app', tracked, new Set(['/app\0a.ts', '/app\0src/b.ts']))).toBe(
      'checked'
    )
    expect(filesCheckState('/app', untrackedFiles(app), new Set(['/app\0new.ts']))).toBe('mixed')
  })

  it('checks every file of a partly checked set, and unchecks a fully checked one, leaving others', () => {
    const partly = new Set(['/app\0a.ts', '/lib\0c.ts'])
    const all = toggleFilesChecks('/app', trackedFiles(app), partly)
    expect([...all].toSorted()).toEqual(['/app\0a.ts', '/app\0src/b.ts', '/lib\0c.ts'])
    expect([...toggleFilesChecks('/app', trackedFiles(app), all)]).toEqual(['/lib\0c.ts'])
  })
})

describe('keepListedChecks', () => {
  it('drops checks of files no longer listed on that side and keeps the same set otherwise', () => {
    const checked = new Set([
      fileKey('/app', 'a.ts'),
      fileKey('/app', 'gone.ts'),
      fileKey('/app', 'new.ts'),
      '/notes\0x'
    ])
    expect([...keepListedChecks(checked, [app, notes], trackedFiles)]).toEqual(['/app\0a.ts'])
    expect([...keepListedChecks(checked, [app, notes], untrackedFiles)]).toEqual(['/app\0new.ts'])
    const kept = new Set(['/app\0a.ts'])
    expect(keepListedChecks(kept, [app], trackedFiles)).toBe(kept)
  })
})

describe('checkedFilesByGroup', () => {
  it('names the groups with checked files of that side in workspace order, each with those files', () => {
    const checked = new Set(['/lib\0c.ts', '/app\0src/b.ts', '/app\0new.ts'])
    const result = checkedFilesByGroup([notes, app, clean, lib], checked, trackedFiles)
    expect(result.map(({ group, files }) => [group.root, files.map((each) => each.path)])).toEqual([
      ['/app', ['src/b.ts']],
      ['/lib', ['c.ts']]
    ])
  })
})
