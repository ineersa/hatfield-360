import { type ElectronApplication, expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { showView } from './editor-page'
import { withApp } from './launch-app'

/** The first performance log line main prints that matches `pattern`, once it is on disk. */
function nextLogged(app: ElectronApplication, pattern: RegExp): Promise<string> {
  const stderr = app.process().stderr
  if (!stderr) throw new Error('The app has no stderr.')
  return new Promise((resolve) => {
    let seen = ''
    const onData = (chunk: Buffer): void => {
      seen += chunk.toString('utf8')
      const line = seen
        .split('\n')
        .find((text) => text.startsWith('[performance] ') && pattern.test(text))
      if (line === undefined) return
      stderr.off('data', onData)
      resolve(line.slice('[performance] '.length))
    }
    stderr.on('data', onData)
  })
}

/** Keeps the thread it runs on busy for `ms`, however loaded the machine is. */
const block = (ms: number): void => {
  const until = performance.now() + ms
  while (performance.now() < until) {
    // Busy on purpose.
  }
}

test('a slow page frame and a main-process stall each leave a line in the performance log', async () => {
  await withApp(async (app, page) => {
    const log = join(
      await app.evaluate(({ app: electronApp }) => electronApp.getPath('logs')),
      'performance.log'
    )

    const frame = nextLogged(
      app,
      / renderer frame \d+ ms · view files · after click "Files" \d+ ms before/
    )
    await showView(page, 'Files')
    await page.evaluate(block, 300)
    const frameLine = await frame

    const stall = nextLogged(app, / main stall \d+ ms · /)
    await app.evaluate((_electron, ms) => {
      const until = performance.now() + ms
      while (performance.now() < until) {
        // Busy on purpose.
      }
    }, 400)
    const stallLine = await stall

    const written = await readFile(log, 'utf8')
    expect(written).toContain(frameLine)
    expect(written).toContain(stallLine)
  })
})
