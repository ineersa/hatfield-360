import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OpenFileWatchers } from './open-file-watchers'
import { projectCovering } from './project-watch'

describe('OpenFileWatchers', () => {
  let dir: string
  let watchers: OpenFileWatchers

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'hatfield-open-files-')))
    watchers = new OpenFileWatchers(
      () => undefined,
      () => Promise.resolve([dir])
    )
  })

  afterEach(async () => {
    watchers.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('opening a file never starts a watcher of its whole folder', async () => {
    const notes = join(dir, 'notes.txt')
    await writeFile(notes, 'one')
    await watchers.set(new Map([[notes, notes]]))
    expect(projectCovering(notes)).toBeNull()
  })
})
