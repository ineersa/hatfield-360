import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { makeTempDir, saveScreenshot, withApp } from './launch-app'

const viewButton = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name, exact: true })
const sidePanel = (page: Page, view: string) =>
  page.getByRole('complementary', { name: `${view} panel` })
const resizeHandle = (page: Page, view: string) =>
  page.getByRole('separator', { name: `Resize ${view} panel` })

const windowBounds = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    if (!window) throw new Error('no window')
    return window.getBounds()
  })

const readWindowState = async (userData: string): Promise<unknown> =>
  JSON.parse(await readFile(join(userData, 'window-state.json'), 'utf8'))

test('the window size, position and layout come back after a restart', async () => {
  const [userData, cleanUserData] = await makeTempDir('user-data')
  const bounds = { x: 120, y: 90, width: 900, height: 650 }
  const applied = { ...bounds }
  let initial = { ...bounds }
  try {
    await withApp(
      async (app, page) => {
        initial = await windowBounds(app)
        await app.evaluate(({ BrowserWindow }, next) => {
          BrowserWindow.getAllWindows()[0]?.setBounds(next)
        }, bounds)
        // Window managers may adjust what was asked for; what the window ends up with is what must come back.
        await expect.poll(() => windowBounds(app)).not.toEqual(initial)
        Object.assign(applied, await windowBounds(app))
        expect(Math.abs(applied.width - bounds.width)).toBeLessThanOrEqual(8)
        // Collapse the Agents panel, then switch to Files and widen its panel.
        await viewButton(page, 'Agents').click()
        await expect(sidePanel(page, 'Agents')).toHaveCount(0)
        await viewButton(page, 'Files').click()
        await resizeHandle(page, 'Files').focus()
        await page.keyboard.press('ArrowRight')
        await page.keyboard.press('ArrowRight')
        await expect(resizeHandle(page, 'Files')).toHaveAttribute('aria-valuenow', '332')

        // Main checks what the page sends.
        await expect(
          page.evaluate("window.desktop.saveShellLayout({ activeView: 'terminal', panels: {} })")
        ).rejects.toThrow('Invalid shell layout')
      },
      { userDataDir: userData }
    )
    // Quitting writes the state at once, without waiting for the save delay.
    expect(await readWindowState(userData)).toEqual({
      version: 1,
      window: { ...applied, maximized: false },
      layout: {
        activeView: 'files',
        panels: {
          agents: { width: 300, collapsed: true },
          files: { width: 332, collapsed: false },
          git: { width: 300, collapsed: false }
        },
        notificationsWidth: 380
      }
    })

    await withApp(
      async (app, page) => {
        // Fractional display scaling may round the reopened window by a pixel or two.
        const reopened = await windowBounds(app)
        for (const key of ['x', 'y', 'width', 'height'] as const) {
          expect(Math.abs(reopened[key] - applied[key])).toBeLessThanOrEqual(8)
        }
        await expect(page.getByRole('main', { name: 'Files' })).toBeVisible()
        await expect(viewButton(page, 'Files')).toHaveAttribute('aria-pressed', 'true')
        await expect(resizeHandle(page, 'Files')).toHaveAttribute('aria-valuenow', '332')
        await saveScreenshot(page, 'window-state-restored')
        await viewButton(page, 'Agents').click()
        await expect(page.getByRole('main', { name: 'Agents' })).toBeVisible()
        await expect(sidePanel(page, 'Agents')).toHaveCount(0)
      },
      { userDataDir: userData }
    )
    // Reopening without moving the window saves the same bounds, so it doesn't creep on every launch.
    expect(await readWindowState(userData)).toMatchObject({
      window: { ...applied, maximized: false }
    })
  } finally {
    await cleanUserData()
  }
})

test('a window saved off every display opens centred, a damaged layout falls back to the default', async () => {
  const [userData, cleanUserData] = await makeTempDir('user-data')
  await writeFile(
    join(userData, 'window-state.json'),
    JSON.stringify({
      version: 1,
      window: { x: -5000, y: -5000, width: 900, height: 650, maximized: true },
      layout: { activeView: 'terminal', panels: {} }
    })
  )
  try {
    await withApp(
      async (app, page) => {
        const workArea = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea)
        const width = Math.min(1200, workArea.width)
        const height = Math.min(800, workArea.height)
        const placed = await windowBounds(app)
        const centre = {
          x: workArea.x + Math.round((workArea.width - width) / 2),
          y: workArea.y + Math.round((workArea.height - height) / 2),
          width,
          height
        }
        // Within a window manager's few pixels of adjustment.
        for (const key of ['x', 'y', 'width', 'height'] as const) {
          expect(Math.abs(placed[key] - centre[key])).toBeLessThanOrEqual(8)
        }
        await expect(page.getByRole('main', { name: 'Agents' })).toBeVisible()
        await expect(resizeHandle(page, 'Agents')).toHaveAttribute('aria-valuenow', '300')
      },
      { userDataDir: userData }
    )
    // The hidden test window is never maximized, but the user's maximized window stays so.
    expect(await readWindowState(userData)).toMatchObject({ window: { maximized: true } })
  } finally {
    await cleanUserData()
  }
})
