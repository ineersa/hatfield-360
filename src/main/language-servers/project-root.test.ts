import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { projectRoot } from './project-root'

const markers = ['tsconfig.json', 'package.json']
let base: string
let folder: string

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'project-root-')))
  // A marker above the workspace folder must never be chosen.
  await writeFile(join(base, 'package.json'), '{}')
  folder = join(base, 'repo')
  await mkdir(join(folder, 'packages', 'web', 'src', 'deep'), { recursive: true })
  await mkdir(join(folder, 'scripts'), { recursive: true })
})

afterEach(() => rm(base, { recursive: true, force: true }))

describe('projectRoot', () => {
  it('is the nearest folder above the file holding a marker', async () => {
    await writeFile(join(folder, 'package.json'), '{}')
    await writeFile(join(folder, 'packages', 'web', 'tsconfig.json'), '{}')
    const file = join(folder, 'packages', 'web', 'src', 'deep', 'a.ts')
    expect(await projectRoot(file, folder, markers)).toBe(join(folder, 'packages', 'web'))
    expect(await projectRoot(join(folder, 'scripts', 'b.ts'), folder, markers)).toBe(folder)
  })

  it('is the workspace folder when nothing inside it holds a marker', async () => {
    const file = join(folder, 'packages', 'web', 'src', 'a.ts')
    expect(await projectRoot(file, folder, markers)).toBe(folder)
  })
})
