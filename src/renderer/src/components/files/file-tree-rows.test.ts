import { describe, expect, it } from 'vitest'
import type { DirectoryEntry, DirectoryListing } from '../../../../shared/file-tree-api'
import { locateInTree, nameOf, treeRows, type TreeRoot } from './file-tree-rows'

const project: TreeRoot = {
  path: '/work/app',
  name: 'app',
  branch: 'main',
  folder: { path: '/work/app', name: 'app', kind: 'project', missing: false, multiRepo: false },
  // A linked worktree kept inside its project's folder.
  worktrees: [{ path: '/work/app/.worktrees/fix', name: 'fix', branch: 'fix' }],
  nested: {}
}
const notes: TreeRoot = {
  path: '/notes',
  name: 'notes',
  branch: null,
  folder: { path: '/notes', name: 'notes', kind: 'folder', missing: false, multiRepo: false },
  worktrees: [],
  nested: {}
}

/** The tree's roots as the file tree store holds them: shown folders only, worktrees by path. */
const shown = (...roots: TreeRoot[]) =>
  roots
    .filter((root) => !root.folder.missing)
    .map((root) => ({
      path: root.path,
      worktrees: root.worktrees.map((tree) => tree.path),
      nested: Object.fromEntries(
        Object.entries(root.nested).map(([folder, trees]) => [
          folder,
          trees.map((tree) => tree.path)
        ])
      )
    }))

const entry = (folder: string, name: string, kind: DirectoryEntry['kind']): DirectoryEntry => ({
  name,
  path: `${folder}/${name}`,
  kind,
  symlink: false,
  ignored: false
})

const listing = (path: string, entries: DirectoryEntry[]): DirectoryListing => ({
  path,
  status: 'ok',
  entries
})

describe('locateInTree', () => {
  it('expands each folder down to a file, under its root', () => {
    expect(locateInTree(shown(notes, project), '/work/app/src/lib/keys.ts')).toEqual({
      folders: ['/work/app', '/work/app/src', '/work/app/src/lib'],
      key: '/work/app\0src\0lib\0keys.ts'
    })
    expect(locateInTree(shown(notes, project), '/notes/todo.md')).toEqual({
      folders: ['/notes'],
      key: '/notes\0todo.md'
    })
  })

  it('finds a worktree file under the worktree, not its project folder', () => {
    expect(locateInTree(shown(project), '/work/app/.worktrees/fix/main.ts')).toEqual({
      folders: ['/work/app', '/work/app/.worktrees/fix'],
      key: '/work/app\0\0worktree\0/work/app/.worktrees/fix\0main.ts'
    })
  })

  it('finds nothing outside every folder, or for a root itself', () => {
    expect(locateInTree(shown(project), '/home/me/.config/hatfield/keybindings.json')).toBeNull()
    // A sibling whose name starts like the root's is not inside it.
    expect(locateInTree(shown(project), '/work/application/main.ts')).toBeNull()
    expect(locateInTree(shown(project), '/work/app')).toBeNull()
  })

  it("lists a multi-repo folder's repository worktrees under that repository, and finds files in them", () => {
    const apps: TreeRoot = {
      path: '/work/apps',
      name: 'apps',
      branch: null,
      folder: {
        path: '/work/apps',
        name: 'apps',
        kind: 'project',
        missing: false,
        multiRepo: true
      },
      worktrees: [],
      nested: {
        '/work/apps/api': [{ path: '/work/api-feature', name: 'api-feature', branch: 'feature' }]
      }
    }
    const located = locateInTree(shown(apps), '/work/api-feature/main.ts')
    expect(located?.folders).toEqual(['/work/apps', '/work/apps/api', '/work/api-feature'])
    const listings = {
      '/work/apps': listing('/work/apps', [
        entry('/work/apps', 'api', 'directory'),
        entry('/work/apps', 'web', 'directory')
      ]),
      '/work/apps/api': listing('/work/apps/api', [entry('/work/apps/api', 'a.ts', 'file')]),
      '/work/api-feature': listing('/work/api-feature', [
        entry('/work/api-feature', 'main.ts', 'file')
      ])
    }
    const expanded = Object.fromEntries((located?.folders ?? []).map((path) => [path, true]))
    const { rows } = treeRows([apps], expanded, listings, false)
    expect(rows.map((row) => [row.type, row.depth, nameOf(row)])).toEqual([
      ['root', 0, 'apps'],
      ['entry', 1, 'api'],
      ['worktree', 2, 'feature'],
      ['entry', 3, 'main.ts'],
      ['entry', 2, 'a.ts'],
      ['entry', 1, 'web']
    ])
    expect(rows.find((row) => row.key === located?.key)?.type).toBe('entry')
  })

  it('gives the key of the row the tree shows once those folders are open', () => {
    const located = locateInTree(shown(project), '/work/app/.worktrees/fix/src/main.ts')
    const fix = '/work/app/.worktrees/fix'
    const listings = {
      '/work/app': listing('/work/app', [entry('/work/app', 'README.md', 'file')]),
      [fix]: listing(fix, [entry(fix, 'src', 'directory')]),
      [`${fix}/src`]: listing(`${fix}/src`, [entry(`${fix}/src`, 'main.ts', 'file')])
    }
    const expanded = Object.fromEntries((located?.folders ?? []).map((path) => [path, true]))
    const { rows } = treeRows([project], expanded, listings, false)
    const row = rows.find((candidate) => candidate.key === located?.key)
    expect(row?.type === 'entry' ? row.entry.path : null).toBe(`${fix}/src/main.ts`)
  })
})
