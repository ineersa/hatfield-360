import {
  chmod,
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
import { readFileInRoots, writeFileInRoots, writeFileReadAs } from './guarded-file'

describe('guarded file access', () => {
  let dir: string
  let root: string
  let outside: string

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'hatfield-guarded-')))
    root = join(dir, 'root')
    outside = join(dir, 'outside')
    await mkdir(root)
    await mkdir(outside)
    await writeFile(join(root, 'notes.md'), 'inside')
    await writeFile(join(outside, 'secret'), 'outside')
  })

  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('reads files inside the roots and refuses ones outside', async () => {
    expect(await readFileInRoots(join(root, 'notes.md'), [root])).toEqual({
      text: 'inside',
      real: join(root, 'notes.md')
    })
    await expect(readFileInRoots(join(outside, 'secret'), [root])).rejects.toThrow(
      'Not inside the workspace'
    )
    await expect(readFileInRoots(join(root, '..', 'outside', 'secret'), [root])).rejects.toThrow(
      'Not inside the workspace'
    )
  })

  it('replaces and creates files inside the roots without leaving temp files', async () => {
    await writeFileInRoots(join(root, 'notes.md'), 'edited', [root])
    await writeFileInRoots(join(root, 'new.md'), 'created', [root])
    expect(await readFile(join(root, 'notes.md'), 'utf8')).toBe('edited')
    expect(await readFile(join(root, 'new.md'), 'utf8')).toBe('created')
    expect((await readdir(root)).toSorted()).toEqual(['new.md', 'notes.md'])
  })

  it('refuses to write outside the roots, by path or by a folder that does not exist', async () => {
    await expect(writeFileInRoots(join(outside, 'secret'), 'x', [root])).rejects.toThrow(
      'Not inside the workspace'
    )
    await expect(writeFileInRoots(join(outside, 'new'), 'x', [root])).rejects.toThrow(
      'Not inside the workspace'
    )
    await expect(writeFileInRoots(join(root, 'gone', 'new'), 'x', [root])).rejects.toThrow(
      'Not inside the workspace'
    )
    expect(await readFile(join(outside, 'secret'), 'utf8')).toBe('outside')
    expect(await readdir(outside)).toEqual(['secret'])
  })

  // Symlinks need extra rights on Windows.
  it.skipIf(process.platform === 'win32')(
    'follows symlinks: writes through one inside, refuses one pointing out',
    async () => {
      await symlink(join(root, 'notes.md'), join(root, 'alias.md'))
      await symlink(join(outside, 'secret'), join(root, 'escape'))
      await symlink(outside, join(root, 'escape-dir'))

      await writeFileInRoots(join(root, 'alias.md'), 'through link', [root])
      expect(await readFile(join(root, 'notes.md'), 'utf8')).toBe('through link')

      await expect(readFileInRoots(join(root, 'escape'), [root])).rejects.toThrow(
        'Not inside the workspace'
      )
      await expect(writeFileInRoots(join(root, 'escape'), 'x', [root])).rejects.toThrow(
        'Not inside the workspace'
      )
      await expect(writeFileInRoots(join(root, 'escape-dir', 'new'), 'x', [root])).rejects.toThrow(
        'Not inside the workspace'
      )
      expect(await readdir(outside)).toEqual(['secret'])
      expect(await readFile(join(outside, 'secret'), 'utf8')).toBe('outside')
    }
  )

  it('refuses to write over a folder, leaving nothing next to it', async () => {
    await expect(writeFileInRoots(root, 'x', [root])).rejects.toThrow('Not a file')
    expect((await readdir(dir)).toSorted()).toEqual(['outside', 'root'])
  })

  // Windows has no execute bits; symlinks need extra rights there.
  it.skipIf(process.platform === 'win32')("keeps the replaced file's permissions", async () => {
    const script = join(root, 'run.sh')
    await writeFile(script, 'echo old')
    await chmod(script, 0o755)
    await writeFileInRoots(script, 'echo new', [root])
    expect((await stat(script)).mode & 0o777).toBe(0o755)
  })

  it.skipIf(process.platform === 'win32')(
    'never writes through a link planted where a temp file might go',
    async () => {
      const target = join(root, 'notes.md')
      await symlink(join(outside, 'secret'), `${target}.${process.pid}.tmp`)
      await writeFileInRoots(target, 'edited', [root])
      expect(await readFile(target, 'utf8')).toBe('edited')
      expect(await readFile(join(outside, 'secret'), 'utf8')).toBe('outside')
    }
  )

  it('saves a file read earlier to that same file, outside the roots now', async () => {
    const { real } = await readFileInRoots(join(root, 'notes.md'), [root])
    await writeFileReadAs(join(root, 'notes.md'), 'kept', real)
    expect(await readFile(join(root, 'notes.md'), 'utf8')).toBe('kept')
  })

  it.skipIf(process.platform === 'win32')(
    'refuses a file read earlier that has since become a link elsewhere',
    async () => {
      const notes = join(root, 'notes.md')
      const { real } = await readFileInRoots(notes, [root])
      await rm(notes)
      await symlink(join(outside, 'secret'), notes)
      await expect(writeFileReadAs(notes, 'edited', real)).rejects.toThrow(
        'Not inside the workspace'
      )
      expect(await readFile(join(outside, 'secret'), 'utf8')).toBe('outside')
    }
  )
})
