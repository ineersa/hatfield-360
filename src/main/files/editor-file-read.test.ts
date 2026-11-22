import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EDITOR_FILE_LIMITS } from '../../shared/editor-api'
import { readEditorFile, textVersion } from './editor-file-read'

describe('readEditorFile', () => {
  let dir: string

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'hatfield-editor-read-')))
  })

  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('reads text with a version that a save of the same text matches', async () => {
    await writeFile(join(dir, 'a.txt'), 'héllo\n')
    expect(await readEditorFile(join(dir, 'a.txt'))).toEqual({
      kind: 'text',
      text: 'héllo\n',
      version: textVersion('héllo\n')
    })
  })

  it('tells binary files apart by a NUL byte near the start, without their contents', async () => {
    await writeFile(join(dir, 'image.png'), Buffer.from([0x89, 0x50, 0x00, 0x01]))
    expect(await readEditorFile(join(dir, 'image.png'))).toMatchObject({ kind: 'binary', size: 4 })
  })

  it('reads a large file only up to the limit, cut at a line break', async () => {
    const line = 'y'.repeat(999) + '\n'
    const lines = Math.ceil(EDITOR_FILE_LIMITS.editable / line.length) + 10
    await writeFile(join(dir, 'big.log'), line.repeat(lines))
    const file = await readEditorFile(join(dir, 'big.log'))
    if (file.kind !== 'large') throw new Error(`Read as ${file.kind}`)
    expect(file.size).toBe(line.length * lines)
    expect(file.text.length).toBeLessThanOrEqual(EDITOR_FILE_LIMITS.editable)
    expect(file.text.length % line.length).toBe(0)
  })

  it('says a file is missing instead of failing', async () => {
    expect(await readEditorFile(join(dir, 'gone.txt'))).toEqual({ kind: 'missing' })
  })
})
