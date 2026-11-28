import { describe, expect, it } from 'vitest'
import type { DirectoryEntry, DirectoryListing } from '../../../../shared/file-tree-api'
import { locateInTree, treeRows, type TreeRoot } from './file-tree-rows'

const project: TreeRoot = {
  path: '/work/app',
  name: 'app',
  branch: 'main',
  folder: { path: '/work/app', name: 'app', kind: 'project', missing: false, multiRepo: false },
  // A linked worktree kept inside its project's folder.
  worktrees: [{ path: '/work/app/.worktrees/fix', name: 'fix', branch: 'fix' }]
}
const notes: TreeRoot = {
  path: '/notes',
  name: 'notes',
  branch: null,
  folder: { path: '/notes', name: 'notes', kind: 'folder', missing: false, multiRepo: false },
  worktrees: []
}

/** The tree's roots as the file tree store holds them: shown folders only, worktrees by path. */
const shown = (...roots: TreeRoot[]) =>
  roots
    .filter((root) => !root.folder.missing)
    .map((root) => ({ path: root.path, worktrees: root.worktrees.map((tree) => tree.path) }))

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
