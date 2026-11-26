import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultInstructionsFile, readWorkspaceFile, writeWorkspaceFile } from './workspace-file'

let folder: string
let file: string

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'workspace-file-'))
  file = join(folder, 'team.hatfield-workspace')
})
afterEach(() => rm(folder, { recursive: true, force: true }))

describe('workspace map file path', () => {
  it('defaults to <name>.workspace.md beside the workspace file', async () => {
    await writeWorkspaceFile(file, { folders: [] })
    expect(await readWorkspaceFile(file)).toEqual({ status: 'ok', folders: [] })
    expect(defaultInstructionsFile(file)).toBe(join(folder, 'team.workspace.md'))
  })

  it('stores a map file beside the workspace relative to it and reads it back absolute', async () => {
    await writeWorkspaceFile(file, { folders: [], instructions: join(folder, 'docs', 'map.md') })
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ instructions: 'docs/map.md' })
    expect(await readWorkspaceFile(file)).toEqual({
      status: 'ok',
      folders: [],
      instructions: join(folder, 'docs', 'map.md')
    })
  })

  it('ignores an empty or non-text path, falling back to the default', async () => {
    await writeFile(file, '{"version":1,"folders":[],"instructions":""}')
    expect(await readWorkspaceFile(file)).toEqual({ status: 'ok', folders: [] })
    await writeFile(file, '{"version":1,"folders":[],"instructions":7}')
    expect(await readWorkspaceFile(file)).toEqual({ status: 'ok', folders: [] })
  })
})
