import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type ProjectChange, type ProjectSubscription, watchProject } from './project-watch'

let root: string
let outside: string
let watch: ProjectSubscription
let reported: ProjectChange[]

const start = async (): Promise<void> => {
  reported = []
  watch = watchProject(root, (changes) => reported.push(...changes))
  expect(await watch.ready).toBe(true)
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'project-watch-')))
  outside = await realpath(await mkdtemp(join(tmpdir(), 'project-watch-outside-')))
  await mkdir(join(root, 'src', 'deep'), { recursive: true })
  await mkdir(join(root, 'node_modules', 'dep'), { recursive: true })
  await mkdir(join(root, '.idea'))
  await writeFile(join(root, 'src', 'deep', 'a.ts'), 'a')
  await writeFile(join(root, '.gitignore'), 'node_modules/\n.idea/\nbuild/\n')
  await promisify(execFile)('git', ['init', '-q'], { cwd: root })
})

afterEach(async () => {
  watch.stop()
  await rm(root, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

const kinds = () => new Map(reported.map((change) => [change.path, change.kind]))

describe('watchProject', () => {
  it('reports files changed, created and deleted in any folder under the root', async () => {
    await start()
    await writeFile(join(root, 'src', 'deep', 'a.ts'), 'changed')
    await writeFile(join(root, 'b.ts'), 'b')
    await expect.poll(() => kinds().get(join(root, 'b.ts'))).toBe('add')
    await expect.poll(() => kinds().get(join(root, 'src', 'deep', 'a.ts'))).toBe('change')
    reported = []
    await rm(join(root, 'src'), { recursive: true })
    await expect.poll(() => kinds().get(join(root, 'src', 'deep', 'a.ts'))).toBe('unlink')
    expect(reported).toContainEqual({ path: join(root, 'src'), kind: 'unlink', folder: true })
  })

  it('reports folders made at once or moved in with their files, then watches them', async () => {
    await start()
    await mkdir(join(root, 'a', 'b'), { recursive: true })
    await writeFile(join(root, 'a', 'b', 'f.ts'), 'f')
    await mkdir(join(outside, 'pkg', 'inner'), { recursive: true })
    await writeFile(join(outside, 'pkg', 'inner', 'c.ts'), 'c')
    await rename(join(outside, 'pkg'), join(root, 'pkg'))
    await expect.poll(() => kinds().get(join(root, 'a', 'b', 'f.ts'))).toBe('add')
    await expect.poll(() => kinds().get(join(root, 'pkg', 'inner', 'c.ts'))).toBe('add')
    reported = []
    await writeFile(join(root, 'a', 'b', 'g.ts'), 'g')
    await writeFile(join(root, 'pkg', 'inner', 'd.ts'), 'd')
    await expect.poll(() => kinds().get(join(root, 'a', 'b', 'g.ts'))).toBe('add')
    await expect.poll(() => kinds().get(join(root, 'pkg', 'inner', 'd.ts'))).toBe('add')
  })

  it('leaves out what git ignores, even in folders made later, and .git itself', async () => {
    await start()
    expect(watch.covers(join(root, 'node_modules', 'dep', 'index.js'))).toBe(false)
    expect(watch.covers(join(root, 'src', 'deep', 'a.ts'))).toBe(true)
    await mkdir(join(root, 'build'))
    await expect.poll(() => watch.covers(join(root, 'build', 'out.js'))).toBe(false)
    await writeFile(join(root, 'node_modules', 'dep', 'index.js'), 'x')
    await writeFile(join(root, '.idea', 'workspace.xml'), 'x')
    await writeFile(join(root, '.git', 'HEAD'), 'ref: refs/heads/other\n')
    await writeFile(join(root, 'build', 'out.js'), 'x')
    // Changes arrive in order: once this one is in, the ones before it would be too.
    await writeFile(join(root, 'marker.ts'), 'x')
    await expect.poll(() => kinds().has(join(root, 'marker.ts'))).toBe(true)
    for (const ignored of [
      'node_modules/dep/index.js',
      '.idea/workspace.xml',
      '.git/HEAD',
      'build/out.js'
    ]) {
      expect(kinds().has(join(root, ignored))).toBe(false)
    }
  })

  it('watches a folder again once .gitignore stops ignoring it', async () => {
    await start()
    await writeFile(join(root, '.gitignore'), 'node_modules/\n')
    await expect.poll(() => watch.covers(join(root, '.idea', 'workspace.xml'))).toBe(true)
    await writeFile(join(root, '.idea', 'workspace.xml'), 'x')
    await expect.poll(() => kinds().get(join(root, '.idea', 'workspace.xml'))).toBe('add')
  })

  it('watches everything but .git in a folder git does not manage', async () => {
    await rm(join(root, '.git'), { recursive: true })
    await mkdir(join(root, '.git'))
    await start()
    await writeFile(join(root, 'node_modules', 'dep', 'index.js'), 'x')
    await writeFile(join(root, '.git', 'HEAD'), 'x')
    await expect.poll(() => kinds().get(join(root, 'node_modules', 'dep', 'index.js'))).toBe('add')
    expect(kinds().has(join(root, '.git', 'HEAD'))).toBe(false)
  })

  it('keeps one watcher per folder, which outlives a listener that leaves', async () => {
    await start()
    const other: ProjectChange[] = []
    const second = watchProject(root, (changes) => other.push(...changes))
    await second.ready
    second.stop()
    await writeFile(join(root, 'b.ts'), 'b')
    await expect.poll(() => kinds().get(join(root, 'b.ts'))).toBe('add')
    expect(other).toEqual([])
  })
})
