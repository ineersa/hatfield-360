import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createEntry,
  invalidEntryName,
  outermostPaths,
  renameEntry,
  resolveChangeableEntry
} from './tree-file-operations'

describe('invalidEntryName', () => {
  it('accepts ordinary names, dotfiles and spaces', () => {
    expect(invalidEntryName('a.ts')).toBeNull()
    expect(invalidEntryName('.env.local')).toBeNull()
    expect(invalidEntryName('my notes.md')).toBeNull()
  })

  it('refuses empty names, dot names and separators', () => {
    expect(invalidEntryName('  ')).toBe('A name is required')
    expect(invalidEntryName('..')).toBe('".." is not a valid name')
    expect(invalidEntryName('src/a.ts')).toBe('A name cannot contain / or \\')
    expect(invalidEntryName('a\\b')).toBe('A name cannot contain / or \\')
  })
})

// Symlinks need extra rights on Windows; the rules are the same there.
describe.skipIf(process.platform === 'win32')('changing tree entries', () => {
  let dir: string
  let root: string
  let outside: string

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'tree-ops-')))
    root = join(dir, 'app')
    outside = join(dir, 'outside')
    await mkdir(join(root, 'src'), { recursive: true })
    await mkdir(join(root, '.worktrees', 'feature'), { recursive: true })
    await mkdir(outside)
    await writeFile(join(root, 'src', 'a.ts'), 'a')
    await writeFile(join(root, 'src', 'b.ts'), 'b')
    await writeFile(join(outside, 'secret.txt'), 's')
  })

  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('resolves an entry inside a root', async () => {
    const path = join(root, 'src', 'a.ts')
    await expect(resolveChangeableEntry(path, [root])).resolves.toBe(path)
  })

  it('refuses a root, a folder holding a worktree root, and paths outside the roots', async () => {
    const worktree = join(root, '.worktrees', 'feature')
    await expect(resolveChangeableEntry(root, [root])).rejects.toThrow(/workspace folder/)
    await expect(
      resolveChangeableEntry(join(root, '.worktrees'), [root, worktree])
    ).rejects.toThrow(/workspace folder/)
    await expect(resolveChangeableEntry(join(outside, 'secret.txt'), [root])).rejects.toThrow(
      'Not inside the workspace'
    )
    await expect(resolveChangeableEntry('src/a.ts', [root])).rejects.toThrow('absolute')
  })

  it('treats a link as the entry itself, and refuses paths reached through a linked folder', async () => {
    await symlink(join(outside, 'secret.txt'), join(root, 'secret-link'))
    await symlink(outside, join(root, 'outside-link'))
    await expect(resolveChangeableEntry(join(root, 'secret-link'), [root])).resolves.toBe(
      join(root, 'secret-link')
    )
    await expect(
      resolveChangeableEntry(join(root, 'outside-link', 'secret.txt'), [root])
    ).rejects.toThrow('Not inside the workspace')
  })

  it('renames within the folder and refuses to replace an existing entry', async () => {
    const renamed = await renameEntry(join(root, 'src', 'a.ts'), 'c.ts', [root])
    expect(renamed).toBe(join(root, 'src', 'c.ts'))
    expect((await readdir(join(root, 'src'))).toSorted()).toEqual(['b.ts', 'c.ts'])
    await expect(renameEntry(renamed, 'b.ts', [root])).rejects.toThrow('b.ts already exists')
    await expect(renameEntry(renamed, '../c.ts', [root])).rejects.toThrow('cannot contain')
  })
})

describe.skipIf(process.platform === 'win32')('createEntry', () => {
  let dir: string
  let root: string
  let outside: string

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'tree-create-')))
    root = join(dir, 'app')
    outside = join(dir, 'outside')
    await mkdir(join(root, 'src'), { recursive: true })
    await mkdir(outside)
    await writeFile(join(root, 'src', 'a.ts'), 'a')
  })

  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('creates an empty file or a folder, with the folders a nested name holds', async () => {
    const file = await createEntry(root, 'lib/util/x.ts', 'file', [root])
    expect(file).toBe(join(root, 'lib', 'util', 'x.ts'))
    expect(await readFile(file, 'utf8')).toBe('')
    const folder = await createEntry(join(root, 'src'), 'parts', 'directory', [root])
    expect((await stat(folder)).isDirectory()).toBe(true)
    // An existing folder on the way is used as it is.
    await createEntry(root, 'src/b.ts', 'file', [root])
    expect((await readdir(join(root, 'src'))).toSorted()).toEqual(['a.ts', 'b.ts', 'parts'])
  })

  it('never replaces an entry and refuses invalid names', async () => {
    await expect(createEntry(root, 'src/a.ts', 'file', [root])).rejects.toThrow(
      'a.ts already exists'
    )
    expect(await readFile(join(root, 'src', 'a.ts'), 'utf8')).toBe('a')
    await expect(createEntry(root, 'src', 'directory', [root])).rejects.toThrow(
      'src already exists'
    )
    await expect(createEntry(root, '../x.ts', 'file', [root])).rejects.toThrow('not a valid name')
    await expect(createEntry(root, 'a//b.ts', 'file', [root])).rejects.toThrow('A name is required')
    await expect(createEntry(root, 'src/a.ts/x.ts', 'file', [root])).rejects.toThrow(
      'a.ts is not a folder'
    )
  })

  it('creates nothing through a link that leads out of the workspace', async () => {
    await symlink(outside, join(root, 'out'))
    await expect(createEntry(root, 'out/x.ts', 'file', [root])).rejects.toThrow(
      'out is not a folder in the workspace'
    )
    await expect(createEntry(outside, 'x.ts', 'file', [root])).rejects.toThrow(
      'Not inside the workspace'
    )
    expect(await readdir(outside)).toEqual([])
  })
})

describe('outermostPaths', () => {
  it('drops what is inside another of the paths, and repeats', () => {
    expect(
      outermostPaths(['/w/a', '/w/a/b', '/w/a/b/c.ts', '/w/ab', '/w/d.ts', '/w/d.ts'])
    ).toEqual(['/w/a', '/w/ab', '/w/d.ts'])
  })
})
