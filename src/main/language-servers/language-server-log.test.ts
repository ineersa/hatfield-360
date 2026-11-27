import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openServerLog } from './language-server-log'

let folder: string

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'language-server-log-'))
})

afterEach(async () => {
  await rm(folder, { recursive: true, force: true })
})

describe('openServerLog', () => {
  it('appends every write in order to one file per server and root, creating the folder', async () => {
    const logs = join(folder, 'logs')
    const first = openServerLog(logs, 'PHP', '/projects/a')
    first.write('one\n')
    first.write('two\n')
    await first.flushed()
    const again = openServerLog(logs, 'PHP', '/projects/a')
    again.write('three\n')
    await again.flushed()
    expect(again.path).toBe(first.path)
    expect(await readFile(first.path, 'utf8')).toBe('one\ntwo\nthree\n')
    expect(openServerLog(logs, 'PHP', '/projects/b').path).not.toBe(first.path)
    expect(openServerLog(logs, 'Go', '/projects/a').path).not.toBe(first.path)
  })

  it('moves a log past its size cap aside when the server starts again', async () => {
    const { path } = openServerLog(folder, 'PHP', '/projects/a')
    await writeFile(path, 'x'.repeat(3 * 1024 * 1024))
    const log = openServerLog(folder, 'PHP', '/projects/a')
    log.write('fresh\n')
    await log.flushed()
    expect(await readFile(path, 'utf8')).toBe('fresh\n')
    expect((await stat(`${path}.1`)).size).toBe(3 * 1024 * 1024)
  })
})
