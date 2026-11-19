import { expect, test } from '@playwright/test'
import { saveScreenshot, withApp } from './launch-app'

test('status bar shows app info fetched over IPC without showing a window', async () => {
  await withApp(async (app, page) => {
    await expect(page.getByTestId('app-info')).toContainText('Hatfield 360 v')
    await expect(page.getByTestId('app-info')).toContainText('Electron')

    const visible = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((window) => window.isVisible())
    )
    expect(visible).toBe(false)

    await saveScreenshot(page, 'app-launch')
  })
})
