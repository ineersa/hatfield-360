import { expect, test, type Page } from '@playwright/test'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { clickMenuItem, submenuLabels } from './app-menu'
import { makeTempDir, saveScreenshot, withApp } from './launch-app'

const settingsMain = (page: Page) => page.getByRole('main', { name: 'Settings' })
const message = (page: Page) => page.getByRole('alert', { name: 'Settings message' })
const projectIcon = (page: Page, name: string) =>
  page
    .getByRole('list', { name: 'Workspace folders' })
    .getByRole('listitem')
    .filter({ hasText: name })
    .locator('svg[data-icon-theme]')

async function expectAppFont(page: Page, family: RegExp, size: string, small: string) {
  await expect(page.locator('body')).toHaveCSS('font-size', size)
  await expect(page.locator('body')).toHaveCSS('font-family', family)
  // The status bar uses the smaller UI text size, which follows app.fontSize.
  await expect(page.locator('footer')).toHaveCSS('font-size', small)
}

test('settings.json sets the app font and icon set at launch and applies every save live', async () => {
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
    `{
      // Comments and trailing commas are fine, as in VS Code.
      "app.fontFamily": "Noto Sans",
      "app.fontSize": 17,
      "workbench.iconTheme": "lucide",
    }`
  )
  const folderName = projects.split(/[\\/]/).at(-1) ?? ''
  try {
    await withApp(
      async (app, page) => {
        await expectAppFont(page, /^"?Noto Sans"?, "Inter Variable"/, '17px', '15px')
        await expect(projectIcon(page, folderName)).toHaveAttribute('data-icon-theme', 'lucide')
        await expect(message(page)).toHaveCount(0)
        await saveScreenshot(page, 'settings-font-17-lucide')

        await writeFile(settings, '{ "app.fontSize": 12, "workbench.iconTheme": "catppuccin" }')
        await expectAppFont(page, /^"Inter Variable"/, '12px', '10px')
        await expect(projectIcon(page, folderName)).toHaveAttribute('data-icon-theme', 'catppuccin')

        // A half-typed edit: the last good settings stay and the problem is named.
        await writeFile(settings, '{ "app.fontSize": 20, "workbench.iconTheme": "lucide"')
        await expect(message(page)).toContainText('settings.json is not valid JSON')
        await expectAppFont(page, /^"Inter Variable"/, '12px', '10px')
        await expect(projectIcon(page, folderName)).toHaveAttribute('data-icon-theme', 'catppuccin')
        await saveScreenshot(page, 'settings-message')
        await message(page).getByRole('button', { name: 'Dismiss' }).click()
        await expect(message(page)).toHaveCount(0)

        // Bad values are ignored one by one; the good ones apply.
        await writeFile(settings, '{ "app.fontSize": "big", "workbench.iconTheme": "lucide" }')
        await expect(message(page)).toHaveText('Settings: "app.fontSize" must be a number.')
        await expect(projectIcon(page, folderName)).toHaveAttribute('data-icon-theme', 'lucide')
        await expectAppFont(page, /^"Inter Variable"/, '12px', '10px')

        // Without the file every setting is back at its default.
        await rm(settings)
        await expect(message(page)).toHaveCount(0)
        await expectAppFont(page, /^"Inter Variable"/, '14px', '12px')
        await expect(projectIcon(page, folderName)).toHaveAttribute('data-icon-theme', 'catppuccin')

        expect(await submenuLabels(app, 'preferences')).toEqual([
          'Settings',
          'Open Settings (JSON)'
        ])
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
    await cleanProjects()
  }
})

test('the Settings page writes each change into settings.json and follows edits to the file', async () => {
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
    '{\n  // my terminal\n  "terminal.fontSize": 15,\n  "app.fontFamily": "Noto Sans"\n}\n'
  )
  const folderName = projects.split(/[\\/]/).at(-1) ?? ''
  try {
    await withApp(
      async (app, page) => {
        await clickMenuItem(app, 'open-settings')
        const settingsPage = settingsMain(page)
        await expect(settingsPage.getByRole('heading', { name: 'Settings' })).toBeVisible()
        await expect(settingsPage.getByLabel('App font family', { exact: true })).toHaveValue(
          'Noto Sans'
        )

        await settingsPage.getByLabel('App font size', { exact: true }).fill('16')
        await settingsPage.getByLabel('App font size', { exact: true }).press('Enter')
        await expect(page.locator('body')).toHaveCSS('font-size', '16px')
        await expect
          .poll(() => readFile(settings, 'utf8'))
          .toBe(
            '{\n  // my terminal\n  "terminal.fontSize": 15,\n  "app.fontFamily": "Noto Sans",\n  "app.fontSize": 16\n}\n'
          )

        await settingsPage.getByText('Lucide', { exact: true }).click()
        await expect(projectIcon(page, folderName)).toHaveAttribute('data-icon-theme', 'lucide')
        await expect(settingsPage.getByRole('radio', { name: 'Lucide' })).toBeChecked()

        // Sizes are clamped like in the file; resetting removes the setting.
        await settingsPage.getByLabel('Editor font size', { exact: true }).fill('50')
        await settingsPage.getByLabel('Editor font size', { exact: true }).press('Enter')
        await expect(settingsPage.getByLabel('Editor font size', { exact: true })).toHaveValue('32')
        await settingsPage.getByRole('button', { name: 'Reset App font family' }).click()
        await expect(settingsPage.getByLabel('App font family', { exact: true })).toHaveValue(
          /^'Inter Variable'/
        )
        await expect(page.locator('body')).toHaveCSS('font-family', /^"Inter Variable"/)
        await expect
          .poll(() => readFile(settings, 'utf8'))
          .toBe(
            '{\n  // my terminal\n  "terminal.fontSize": 15,\n  "app.fontSize": 16,\n  "workbench.iconTheme": "lucide",\n  "editor.fontSize": 32\n}\n'
          )
        await saveScreenshot(page, 'settings-page')

        // Edits to the file show up on the open page.
        await writeFile(settings, '{ "terminal.fontSize": 18 }')
        await expect(settingsPage.getByLabel('Terminal font size', { exact: true })).toHaveValue(
          '18'
        )
        await expect(settingsPage.getByLabel('App font size', { exact: true })).toHaveValue('14')
        await writeFile(settings, '{ "terminal.fontSize": ')
        await expect(settingsPage.getByRole('status')).toContainText('settings.json has errors')
        await expect(settingsPage.getByLabel('Terminal font size', { exact: true })).toBeDisabled()

        await page.keyboard.press('Escape')
        await expect(settingsMain(page)).toHaveCount(0)
        await page.getByRole('button', { name: 'Settings' }).click()
        await expect(settingsMain(page)).toBeVisible()
        await page.getByRole('button', { name: 'Agents' }).click()
        await expect(page.getByRole('main', { name: 'Agents' })).toBeVisible()
        await expect(page.getByRole('complementary', { name: 'Agents panel' })).toBeVisible()
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
    await cleanProjects()
  }
})
