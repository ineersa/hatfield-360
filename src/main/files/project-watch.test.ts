import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { watchProject } from './project-watch'

describe('watchProject', () => {
  let dir: string

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'hatfield-project-watch-')))
  })

  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('leaves dependency folders out of a folder git does not manage', async () => {
    await mkdir(join(dir, 'node_modules', 'react'), { recursive: true })
    await mkdir(join(dir, '.venv', 'lib'), { recursive: true })
    await mkdir(join(dir, 'src'))
    const project = watchProject(dir, () => undefined)
    try {
      expect(await project.ready).toBe(true)
      expect(project.covers(join(dir, 'src', 'a.ts'))).toBe(true)
      expect(project.covers(join(dir, 'node_modules', 'react', 'index.js'))).toBe(false)
      expect(project.covers(join(dir, '.venv', 'lib', 'site.py'))).toBe(false)
    } finally {
      project.stop()
    }
  })
})
