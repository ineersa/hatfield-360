import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, posix, win32 } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  isPathInside,
  resolveInsideRoots,
  resolveOutsideHome,
  rootRelativePath
} from './path-containment'

describe('isPathInside', () => {
  it('accepts the folder and what is under it, and nothing beside or above it', () => {
    expect(isPathInside('/work/app', '/work/app', posix)).toBe(true)
    expect(isPathInside('/work/app/src/a.ts', '/work/app', posix)).toBe(true)
    expect(isPathInside('/work/app-feature', '/work/app', posix)).toBe(false)
    expect(isPathInside('/work', '/work/app', posix)).toBe(false)
    expect(isPathInside('/work/app/../other', '/work/app', posix)).toBe(false)
    expect(isPathInside('/work/app/..data', '/work/app', posix)).toBe(true)
  })

  it('ignores case and slash style on Windows, and refuses another drive', () => {
    expect(isPathInside('C:/Work/App/src', 'c:\\work\\app', win32)).toBe(true)
    expect(isPathInside('D:\\work\\app', 'C:\\work\\app', win32)).toBe(false)
  })
})

describe('rootRelativePath', () => {
  it('is relative to the innermost root, so a worktree inside its project counts as its own root', () => {
    const roots = ['/work/app', '/work/app/.worktrees/feature']
    expect(rootRelativePath('/work/app/src/a.ts', roots, posix)).toBe('src/a.ts')
    expect(rootRelativePath('/work/app/.worktrees/feature/src/a.ts', roots, posix)).toBe('src/a.ts')
  })

  it('has none for a root itself or a path outside every root', () => {
    expect(rootRelativePath('/work/app', ['/work/app'], posix)).toBeNull()
    expect(rootRelativePath('/work/other/a.ts', ['/work/app'], posix)).toBeNull()
  })

  it('uses Windows separators on Windows', () => {
    expect(rootRelativePath('C:\\work\\app\\src\\a.ts', ['C:\\work\\app'], win32)).toBe('src\\a.ts')
  })
})

// Symlinks need extra rights on Windows; the containment rules are the same there.
describe.skipIf(process.platform === 'win32')('resolveInsideRoots', () => {
  let dir: string
  let root: string
  let outside: string

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'hatfield-containment-')))
    root = join(dir, 'root')
    outside = join(dir, 'outside')
    await mkdir(join(root, 'src'), { recursive: true })
    await mkdir(outside)
    await writeFile(join(root, 'src', 'a.ts'), '')
    await writeFile(join(outside, 'secret'), '')
  })

  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('accepts paths inside a root and refuses relative, absolute and `..` paths out of it', async () => {
    expect(await resolveInsideRoots(join(root, 'src', 'a.ts'), [root])).toBe(
      join(root, 'src', 'a.ts')
    )
    expect(await resolveInsideRoots(root, [root])).toBe(root)
    expect(await resolveInsideRoots('src/a.ts', [root])).toBeNull()
    expect(await resolveInsideRoots(join(outside, 'secret'), [root])).toBeNull()
    expect(await resolveInsideRoots(`${root}/../outside/secret`, [root])).toBeNull()
    expect(await resolveInsideRoots(join(root, 'missing'), [root])).toBeNull()
    expect(await resolveInsideRoots(join(outside, 'secret'), [root, outside])).toBe(
      join(outside, 'secret')
    )
  })

  it('follows symlinks: one pointing out is refused, one staying inside is accepted', async () => {
    await symlink(outside, join(root, 'escape'))
    await symlink(join(root, 'src'), join(root, 'alias'))
    expect(await resolveInsideRoots(join(root, 'escape', 'secret'), [root])).toBeNull()
    expect(await resolveInsideRoots(join(root, 'escape'), [root])).toBeNull()
    expect(await resolveInsideRoots(join(root, 'alias', 'a.ts'), [root])).toBe(
      join(root, 'src', 'a.ts')
    )
  })

  it('accepts paths under a root that is itself a symlink', async () => {
    const linkedRoot = join(dir, 'linked-root')
    await symlink(root, linkedRoot)
    expect(await resolveInsideRoots(join(linkedRoot, 'src', 'a.ts'), [linkedRoot])).toBe(
      join(root, 'src', 'a.ts')
    )
    expect(await resolveInsideRoots(join(root, 'src'), [linkedRoot])).toBe(join(root, 'src'))
    expect(await resolveInsideRoots(join(outside, 'secret'), [linkedRoot])).toBeNull()
  })
})

describe('resolveOutsideHome', () => {
  let base: string
  beforeEach(async () => {
    base = await realpath(await mkdtemp(join(tmpdir(), 'outside-home-')))
    await mkdir(join(base, 'home', '.ssh'), { recursive: true })
    await mkdir(join(base, 'usr'))
    await writeFile(join(base, 'home', '.ssh', 'id_ed25519'), 'secret')
    await writeFile(join(base, 'usr', 'os.py'), 'x')
  })
  afterEach(() => rm(base, { recursive: true, force: true }))

  it('reads outside home, but nothing in it, even through a link from outside', async () => {
    const home = join(base, 'home')
    expect(await resolveOutsideHome(join(base, 'usr', 'os.py'), home)).toBe(
      join(base, 'usr', 'os.py')
    )
    expect(await resolveOutsideHome(join(home, '.ssh', 'id_ed25519'), home)).toBeNull()
    await symlink(join(home, '.ssh', 'id_ed25519'), join(base, 'usr', 'key'))
    expect(await resolveOutsideHome(join(base, 'usr', 'key'), home)).toBeNull()
  })

  it('compares home by where it really is, when it is reached through a link', async () => {
    await symlink(join(base, 'home'), join(base, 'home-link'))
    expect(
      await resolveOutsideHome(join(base, 'home', '.ssh', 'id_ed25519'), join(base, 'home-link'))
    ).toBeNull()
  })
})
