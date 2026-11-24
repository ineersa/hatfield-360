import { mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { invalidEntryName, renameEntry, resolveChangeableEntry } from './tree-file-operations'

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
