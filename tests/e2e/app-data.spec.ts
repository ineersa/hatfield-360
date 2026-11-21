import { expect, test } from '@playwright/test'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { makeTempDir, testingPackagedApp, withApp } from './launch-app'

// Where app data lives can be redirected from the environment on Linux and Windows only; on macOS the
// test would write into the real ~/Library/Application Support.
test.skip(process.platform === 'darwin', 'app data folder cannot be redirected on macOS')

test('runs from the repo keep their app data apart from the installed app', async () => {
  const [appData, clean] = await makeTempDir('app-data')
  try {
    await withApp(
      async (app) => {
        const expected = join(appData, testingPackagedApp ? 'hatfield-360' : 'hatfield-360-dev')
        expect(await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))).toBe(
          expected
        )
        // Chromium's own profile goes there too, and nothing else is created beside it.
        await expect.poll(() => readdir(appData)).toEqual([expected.slice(appData.length + 1)])
        await expect.poll(async () => (await readdir(expected)).length).toBeGreaterThan(0)
      },
      { userDataDir: null, env: { XDG_CONFIG_HOME: appData, APPDATA: appData } }
    )
  } finally {
    await clean()
  }
})
