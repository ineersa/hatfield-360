import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '../..')
// The release workflow points E2E_EXECUTABLE at the packaged app to smoke-test the installable build.
const packagedExecutable = process.env.E2E_EXECUTABLE
const launchTarget = packagedExecutable ? { executablePath: packagedExecutable } : { args: [root] }

/** A fresh temp directory, removed by the returned cleanup. */
export async function makeTempDir(prefix: string): Promise<[string, () => Promise<void>]> {
  const dir = await mkdtemp(join(tmpdir(), `hatfield-e2e-${prefix}-`))
  return [dir, () => rm(dir, { recursive: true, force: true })]
}

/**
 * Launches the app with a hidden window, runs `body`, and always closes the app. Each launch gets its
 * own app data folder (so tests never touch the user's), unless `userDataDir` is passed to share one
 * across restarts.
 */
export async function withApp(
  body: (app: ElectronApplication, page: Page) => Promise<void>,
  options: { userDataDir?: string } = {}
): Promise<void> {
  const [ownDir, cleanup] = options.userDataDir
    ? [options.userDataDir, async () => {}]
    : await makeTempDir('user-data')
  const app = await electron.launch({
    ...launchTarget,
    args: [...(launchTarget.args ?? []), `--user-data-dir=${ownDir}`],
    env: { ...process.env, APP_BACKGROUND_LAUNCH: '1' }
  })
  try {
    await body(app, await app.firstWindow())
  } finally {
    await app.close()
    await cleanup()
  }
}

/** Saves visual evidence to test-results/; nothing compares it to a baseline. */
export async function saveScreenshot(page: Page, name: string): Promise<void> {
  // Under xvfb a hidden window's first capture can fail or hang until a frame is composited, so each attempt is short.
  await expect(async () => {
    await page.screenshot({
      path: resolve(root, `test-results/${name}.png`),
      timeout: 1_000,
      // Hidden windows advance CSS transitions slowly; capture their end state.
      animations: 'disabled'
    })
  }).toPass({ timeout: 15_000 })
}
