import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DirectoryWatchers } from './directory-watchers'

describe('DirectoryWatchers', () => {
  let dir: string
  let sent: string[]
  let watchers: DirectoryWatchers

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'hatfield-watchers-')))
    sent = []
    watchers = new DirectoryWatchers((paths) => sent.push(...paths))
  })

  afterEach(async () => {
    watchers.close()
    await rm(dir, { recursive: true, force: true })
  })

  // Windows can't rename a folder that is being watched.
  it.skipIf(process.platform === 'win32')(
    'watches a folder replaced at the same path anew',
    async () => {
      const folder = join(dir, 'src')
      const other = join(dir, 'other')
      await mkdir(folder)
      await mkdir(other)
      await watchers.set([folder, other], [dir])

      await rename(folder, join(dir, 'src-old'))
      await mkdir(folder)
      // Events arrive in order, so once `other` is reported the rename's own events are in too.
      await writeFile(join(other, 'marker'), '')
      await vi.waitFor(() => expect(sent).toContain(other))
      sent = []

      await watchers.set([folder, other], [dir])
      await writeFile(join(folder, 'new.ts'), '')
      await vi.waitFor(() => expect(sent).toContain(folder))
    }
  )
})
