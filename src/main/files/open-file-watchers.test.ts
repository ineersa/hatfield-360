import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenFileWatchers } from './open-file-watchers'

describe('OpenFileWatchers', () => {
  let dir: string
  let sent: string[]
  let watchers: OpenFileWatchers

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'hatfield-open-files-')))
    sent = []
    watchers = new OpenFileWatchers((paths) => sent.push(...paths))
  })

  afterEach(async () => {
    watchers.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('reports an open file edited, replaced by a rename or deleted, and nothing else', async () => {
    const notes = join(dir, 'notes.txt')
    const other = join(dir, 'other.txt')
    await writeFile(notes, 'one')
    watchers.set(new Map([[notes, notes]]))

    await writeFile(other, 'not open')
    await writeFile(notes, 'two')
    await vi.waitFor(() => expect([...new Set(sent)]).toEqual([notes]))
    sent = []

    // As editors and agents save: a temp file renamed over it.
    await writeFile(join(dir, '.notes.tmp'), 'three')
    await rename(join(dir, '.notes.tmp'), notes)
    await vi.waitFor(() => expect([...new Set(sent)]).toEqual([notes]))
    sent = []

    await rm(notes)
    await vi.waitFor(() => expect([...new Set(sent)]).toEqual([notes]))
  })

  it('stops reporting a file once it is no longer open', async () => {
    const notes = join(dir, 'notes.txt')
    const kept = join(dir, 'kept.txt')
    watchers.set(
      new Map([
        [notes, notes],
        [kept, kept]
      ])
    )
    watchers.set(new Map([[kept, kept]]))
    await writeFile(notes, 'changed')
    // Events arrive in order, so once `kept` is reported the earlier write's are in too.
    await writeFile(kept, 'marker')
    await vi.waitFor(() => expect(sent).toContain(kept))
    expect(sent).not.toContain(notes)
  })

  it('reports the open files of a folder renamed away, and watches a folder made in its place', async () => {
    const src = join(dir, 'src')
    const index = join(src, 'index.ts')
    await mkdir(src)
    await writeFile(index, 'one')
    watchers.set(new Map([[index, index]]))
    // Wait for the watcher to know its folder before moving it.
    await writeFile(index, 'two')
    await vi.waitFor(() => expect(sent).toContain(index))
    sent = []

    await rename(src, join(dir, 'old-src'))
    await vi.waitFor(() => expect([...new Set(sent)]).toEqual([index]))
    sent = []

    await mkdir(src)
    await writeFile(index, 'back')
    await vi.waitFor(() => expect(sent).toContain(index))
  })
})
