import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type TreeChange, TreeWatcher } from './tree-watcher'

let root: string
let watcher: TreeWatcher
let reported: TreeChange[]

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'tree-watcher-')))
  await mkdir(join(root, 'src', 'deep'), { recursive: true })
  await mkdir(join(root, 'node_modules', 'dep'), { recursive: true })
  await mkdir(join(root, '.git'))
  await writeFile(join(root, 'src', 'deep', 'a.ts'), 'a')
  reported = []
  watcher = new TreeWatcher(root, (changes) => reported.push(...changes))
  await watcher.start()
})

afterEach(async () => {
  watcher.close()
  await rm(root, { recursive: true, force: true })
})

const types = () => new Map(reported.map((change) => [change.path, change.type]))

describe('TreeWatcher', () => {
  it('reports files changed, created and deleted in any folder under the root', async () => {
    await writeFile(join(root, 'src', 'deep', 'a.ts'), 'changed')
    await writeFile(join(root, 'b.ts'), 'b')
    await expect.poll(() => types().get(join(root, 'b.ts'))).toBe(1)
    // macOS may report a write as a rename; either way the file is reported.
    await expect.poll(() => types().has(join(root, 'src', 'deep', 'a.ts'))).toBe(true)
    reported = []
    await rm(join(root, 'src'), { recursive: true })
    await expect.poll(() => types().get(join(root, 'src'))).toBe(3)
  })

  it('reports a new folder with the files it arrived with, then watches it', async () => {
    await mkdir(join(root, 'tmp-new', 'inner'), { recursive: true })
    await writeFile(join(root, 'tmp-new', 'inner', 'c.ts'), 'c')
    // The folder is moved in whole, as a checkout or an unpacked archive arrives.
    await rename(join(root, 'tmp-new'), join(root, 'pkg'))
    await expect.poll(() => types().get(join(root, 'pkg', 'inner', 'c.ts'))).toBe(1)
    reported = []
    await writeFile(join(root, 'pkg', 'inner', 'd.ts'), 'd')
    await expect.poll(() => types().get(join(root, 'pkg', 'inner', 'd.ts'))).toBe(1)
  })

  it('watches dependency folders only at their top, and never .git', async () => {
    await writeFile(join(root, 'node_modules', 'dep', 'index.js'), 'x')
    await writeFile(join(root, '.git', 'HEAD'), 'ref')
    await mkdir(join(root, 'node_modules', 'added'))
    await expect.poll(() => types().get(join(root, 'node_modules', 'added'))).toBe(1)
    expect(types().has(join(root, 'node_modules', 'dep', 'index.js'))).toBe(false)
    expect(types().has(join(root, '.git', 'HEAD'))).toBe(false)
  })
})
