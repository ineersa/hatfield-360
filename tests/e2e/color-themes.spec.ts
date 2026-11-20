import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse } from 'jsonc-parser'
import { clickMenuItem } from './app-menu'
import { makeTempDir, saveScreenshot, withApp } from './launch-app'

const windowBackground = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.getBackgroundColor().toLowerCase()
  )

const terminalBackground = (page: Page) =>
  page.getByRole('main', { name: 'Agents' }).locator('.pane-manager-root').first()

test('app, editor and terminal themes come from settings.json and switch live from Settings', async () => {
  const [userData, cleanUserData] = await makeTempDir('user-data')
  const [projects, cleanProjects] = await makeTempDir('projects')
  const settings = join(userData, 'settings.json')
  await mkdir(join(userData, 'workspaces'))
  await writeFile(
    join(userData, 'workspaces', 'default.hatfield-workspace'),
    JSON.stringify({ version: 1, folders: [{ path: projects }] })
  )
  await writeFile(
    settings,
    JSON.stringify({
      'workbench.colorTheme': 'islands-catppuccin-mocha',
      'editor.colorTheme': 'catppuccin-mocha',
      'terminal.colorTheme': 'catppuccin-mocha',
      'terminal.gpuAcceleration': false
    })
  )
  try {
    await withApp(
      async (app, page) => {
        // The window opens in the theme's frame colour, before the page paints.
        await expect.poll(() => windowBackground(app)).toBe('#11111b')
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'islands-catppuccin-mocha')
        await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(17, 17, 27)')

        await page
          .getByRole('main', { name: 'Agents' })
          .getByRole('button', { name: 'New Terminal' })
          .click()
        await expect(terminalBackground(page)).toHaveCSS('background-color', 'rgb(30, 30, 46)')
        await saveScreenshot(page, 'theme-catppuccin-mocha-terminal')

        await clickMenuItem(app, 'open-settings')
        const settingsPage = page.getByRole('main', { name: 'Settings' })
        const keyword = settingsPage
          .getByRole('img', { name: 'Editor theme preview' })
          .locator('[data-token="keyword"]')
          .first()
        await expect(keyword).toHaveCSS('color', 'rgb(203, 166, 247)')
        await saveScreenshot(page, 'theme-catppuccin-mocha-settings')

        await settingsPage.getByRole('combobox', { name: 'App theme' }).selectOption('Islands Dark')
        await settingsPage
          .getByRole('combobox', { name: 'Editor theme' })
          .selectOption('Islands Dark')
        await settingsPage.getByRole('combobox', { name: 'Terminal theme' }).selectOption('Dracula')
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'islands-dark')
        await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(38, 40, 44)')
        await expect(keyword).toHaveCSS('color', 'rgb(207, 142, 109)')
        await expect.poll(() => windowBackground(app)).toBe('#26282c')
        // These are the three defaults, so their keys leave settings.json.
        await expect
          .poll(async (): Promise<unknown> => parse(await readFile(settings, 'utf8')))
          .toEqual({ 'terminal.gpuAcceleration': false })
        await saveScreenshot(page, 'theme-islands-dark-settings')

        await settingsPage.getByRole('button', { name: 'Close Settings' }).click()
        await expect(terminalBackground(page)).toHaveCSS('background-color', 'rgb(40, 42, 54)')
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
    await cleanProjects()
  }
})
