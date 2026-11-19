import { _electron as electron, expect, test } from '@playwright/test'
import { resolve } from 'node:path'

const root = resolve(__dirname, '../..')

test('shell renders app info fetched over IPC without showing a window', async () => {
  const app = await electron.launch({
    args: [root],
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

    // A hidden window may not have composited its first frame yet (notably under xvfb).
    await expect(async () => {
      await page.screenshot({ path: resolve(root, 'test-results/app-launch.png') })
    }).toPass({ timeout: 10_000 })
  } finally {
    await app.close()
  }
})
