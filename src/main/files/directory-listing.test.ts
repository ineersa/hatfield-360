import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DirectoryListing } from '../../shared/file-tree-api'
import { listDirectory } from './directory-listing'

const shape = (listing: DirectoryListing) =>
  listing.status === 'ok'
    ? listing.entries.map(
        ({ name, kind, ignored }) =>
          `${kind === 'directory' ? 'd' : 'f'} ${name}${ignored ? ' (ignored)' : ''}`
      )
    : listing

async function fill(folder: string): Promise<void> {
  await mkdir(join(folder, 'src'), { recursive: true })
  await mkdir(join(folder, 'node_modules'))
  await writeFile(join(folder, '.gitignore'), 'node_modules/\n*.log\n')
  await writeFile(join(folder, 'file10.txt'), '')
  await writeFile(join(folder, 'file9.txt'), '')
  await writeFile(join(folder, 'Readme.md'), '')
  await writeFile(join(folder, 'debug.log'), '')
}

describe('listDirectory', () => {
  let dir: string

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'hatfield-listing-')))
  })

  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('lists folders first, by name with numbers in order, and marks what git ignores in a project', async () => {
    const repo = join(dir, 'repo')
    await mkdir(repo)
    execFileSync('git', ['init', '-q'], { cwd: repo })
    await fill(repo)
    expect(shape(await listDirectory(repo, [{ path: repo, git: true }]))).toEqual([
      'd .git (ignored)',
      'd node_modules (ignored)',
      'd src',
      'f .gitignore',
      'f debug.log (ignored)',
      'f file9.txt',
      'f file10.txt',
      'f Readme.md'
    ])
  })

  it('marks nothing in a plain folder, even one with ignore rules', async () => {
    const plain = join(dir, 'plain')
    await mkdir(plain)
    await fill(plain)
    expect(shape(await listDirectory(plain, [{ path: plain, git: false }]))).toEqual([
      'd node_modules',
      'd src',
      'f .gitignore',
      'f debug.log',
      'f file9.txt',
      'f file10.txt',
      'f Readme.md'
    ])
  })

  it('refuses folders outside the roots', async () => {
    const root = join(dir, 'root')
    await mkdir(join(root, 'inner'), { recursive: true })
    expect(await listDirectory(dir, [{ path: root, git: false }])).toEqual({
      path: dir,
      status: 'error',
      message: 'Not inside the workspace'
    })
    expect(await listDirectory(join(root, 'inner'), [{ path: root, git: false }])).toEqual({
      path: join(root, 'inner'),
      status: 'ok',
      entries: []
    })
  })

  // Symlinks need extra rights on Windows.
  it.skipIf(process.platform === 'win32')(
    'lists a symlink as what it points at, keeps its path under the link, and refuses one pointing out',
    async () => {
      const root = join(dir, 'root')
      await mkdir(join(root, 'src'), { recursive: true })
      await writeFile(join(root, 'src', 'a.ts'), '')
      await symlink(join(root, 'src'), join(root, 'alias'))
      await symlink(join(root, 'gone'), join(root, 'broken'))
      await symlink(dir, join(root, 'escape'))
      const roots = [{ path: root, git: false }]
      const listing = await listDirectory(root, roots)
      expect(shape(listing)).toEqual(['d alias', 'd escape', 'd src', 'f broken'])
      expect(listing.status === 'ok' && listing.entries[0]).toMatchObject({ symlink: true })
      const alias = await listDirectory(join(root, 'alias'), roots)
      expect(alias.status === 'ok' && alias.entries.map((entry) => entry.path)).toEqual([
        join(root, 'alias', 'a.ts')
      ])
      expect(await listDirectory(join(root, 'escape'), roots)).toMatchObject({ status: 'error' })
    }
  )
})
