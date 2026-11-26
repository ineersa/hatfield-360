import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { indexNeedsClearing } from './intelephense-index'

describe('indexNeedsClearing', () => {
  let storage = ''
  beforeEach(async () => {
    storage = join(await mkdtemp(join(tmpdir(), 'intelephense-index-')), 'storage')
  })
  afterEach(() => rm(join(storage, '..'), { recursive: true, force: true }))

  it('clears when a folder is newly excluded, not when the exclusions are the same or fewer', async () => {
    expect(await indexNeedsClearing(storage, '/work/app', ['/work/app/var/**'])).toBe(true)
    expect(await indexNeedsClearing(storage, '/work/app', ['/work/app/var/**'])).toBe(false)
    expect(
      await indexNeedsClearing(storage, '/work/app', ['/work/app/var/**', '/work/app/log/**'])
    ).toBe(true)
    expect(await indexNeedsClearing(storage, '/work/app', ['/work/app/log/**'])).toBe(false)
    // Fewer was recorded: excluding var again clears what it may have indexed meanwhile.
    expect(await indexNeedsClearing(storage, '/work/app', ['/work/app/var/**'])).toBe(true)
  })

  it('keeps each workspace folder apart', async () => {
    expect(await indexNeedsClearing(storage, '/work/app', ['/work/app/var/**'])).toBe(true)
    expect(await indexNeedsClearing(storage, '/work/other', ['/work/other/var/**'])).toBe(true)
    expect(await indexNeedsClearing(storage, '/work/app', ['/work/app/var/**'])).toBe(false)
  })
})
