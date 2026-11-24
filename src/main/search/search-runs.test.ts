import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SearchFileResult } from '../../shared/search-api'
import { startRipgrep } from './ripgrep-search'
import { SearchRuns } from './search-runs'

describe('SearchRuns', () => {
  let dir: string
  /** What each ripgrep run that started found, once it ended. */
  let finishedRuns: Promise<SearchFileResult[]>[]

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'search-runs-'))
    await writeFile(join(dir, 'a.txt'), 'needle\n')
    finishedRuns = []
  })

  afterEach(async () => {
    await Promise.all(finishedRuns)
    await rm(dir, { recursive: true, force: true })
  })

  const launch = (paths: string[], finished: () => void): (() => void) => {
    const run: { stop?: () => void } = {}
    const files: SearchFileResult[] = []
    finishedRuns.push(
      new Promise((resolve) => {
        run.stop = startRipgrep(
          {
            text: 'needle',
            regex: false,
            matchCase: false,
            wholeWord: false,
            fileMask: '',
            includeNonProject: false,
            scope: []
          },
          paths,
          {
            results: (batch) => files.push(...batch),
            done: () => {
              finished()
              resolve(files)
            }
          }
        )
      })
    )
    return () => run.stop?.()
  }

  /** Folders whose check finishes when the returned function is called. */
  const pendingPaths = (): [Promise<string[]>, () => void] => {
    const check: { resolve?: (paths: string[]) => void } = {}
    const paths = new Promise<string[]>((resolve) => {
      check.resolve = resolve
    })
    return [paths, () => check.resolve?.([dir])]
  }

  it('never starts a search cancelled while its folders were being checked', async () => {
    const runs = new SearchRuns<string>()
    const [paths, release] = pendingPaths()
    const started = runs.start('window', 1, paths, launch)
    runs.cancel('window')
    release()
    expect(await started).toBe(false)
    expect(finishedRuns).toHaveLength(0)
  })

  it('starts only the newest search, and a later one after a cancel', async () => {
    const runs = new SearchRuns<string>()
    const [paths, release] = pendingPaths()
    const first = runs.start('window', 1, paths, launch)
    const second = runs.start('window', 2, Promise.resolve([dir]), launch)
    release()
    expect([await first, await second]).toEqual([false, true])
    const [found] = await Promise.all(finishedRuns)
    expect(found?.map((file) => file.path)).toEqual([join(dir, 'a.txt')])

    runs.cancel('window')
    expect(await runs.start('window', 3, Promise.resolve([dir]), launch)).toBe(true)
  })
})
