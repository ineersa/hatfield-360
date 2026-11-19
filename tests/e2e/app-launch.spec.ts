import { _electron as electron, expect, test } from '@playwright/test'
import { resolve } from 'node:path'

const root = resolve(__dirname, '../..')
// The release workflow points E2E_EXECUTABLE at the packaged app to smoke-test the installable build.
const packagedExecutable = process.env.E2E_EXECUTABLE
const launchTarget = packagedExecutable ? { executablePath: packagedExecutable } : { args: [root] }

test('shell renders app info fetched over IPC without showing a window', async () => {
  const app = await electron.launch({
    ...launchTarget,
    env: { ...process.env, APP_BACKGROUND_LAUNCH: '1' }
  })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('heading', { name: 'Hatfield 360' })).toBeVisible()
    await expect(page.getByTestId('app-info')).toContainText('Electron')

    const visible = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((window) => window.isVisible())
    )
    expect(visible).toBe(false)

    // Under xvfb a hidden window's first capture can fail or hang until a frame is composited, so each attempt is short.
    await expect(async () => {
      await page.screenshot({ path: resolve(root, 'test-results/app-launch.png'), timeout: 1_000 })
    }).toPass({ timeout: 15_000 })
  } finally {
    await app.close()
  }
})
