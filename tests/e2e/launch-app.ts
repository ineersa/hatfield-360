import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { resolve } from 'node:path'

const root = resolve(__dirname, '../..')
// The release workflow points E2E_EXECUTABLE at the packaged app to smoke-test the installable build.
const packagedExecutable = process.env.E2E_EXECUTABLE
const launchTarget = packagedExecutable ? { executablePath: packagedExecutable } : { args: [root] }

/** Launches the app with a hidden window, runs `body`, and always closes the app. */
export async function withApp(
  body: (app: ElectronApplication, page: Page) => Promise<void>
): Promise<void> {
  const app = await electron.launch({
    ...launchTarget,
    env: { ...process.env, APP_BACKGROUND_LAUNCH: '1' }
  })
  try {
    await body(app, await app.firstWindow())
  } finally {
    await app.close()
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
