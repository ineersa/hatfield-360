import { type ElectronApplication, expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { showView } from './editor-page'
import { makeTempDir, withApp } from './launch-app'

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

test('a slow page frame leaves a line in the performance log in the app data folder', async () => {
  const [userData, cleanup] = await makeTempDir('user-data')
  try {
    await withApp(
      async (app, page) => {
        const logs = await app.evaluate(({ app: electronApp }) => electronApp.getPath('logs'))
        // Never the installed app's logs: on macOS they are outside app data by default.
        expect(logs).toBe(join(userData, 'logs'))

        const frame = nextLogged(
          app,
          / renderer frame \d+ ms · view files · after click "Files" \d+ ms before/
        )
        await showView(page, 'Files')
        await page.evaluate(block, 300)
        const frameLine = await frame
        expect(await readFile(join(logs, 'performance.log'), 'utf8')).toContain(frameLine)
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanup()
  }
})
