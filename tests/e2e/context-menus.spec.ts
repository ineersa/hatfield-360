import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { makeTempDir, withApp } from './launch-app'
import { CLIPBOARD_TAG, keepUserClipboard } from './user-clipboard'
import { seedWorkspace } from './workspace-seed'

const menu = (page: Page) => page.getByRole('menu')
const menuItems = (page: Page) => menu(page).getByRole('menuitem')
const clipboardText = (app: ElectronApplication) =>
  app.evaluate(({ clipboard }) => clipboard.readText())

async function makeProject(): Promise<[string, () => Promise<void>]> {
  const [dir, cleanup] = await makeTempDir('context-menus')
  const app = join(await realpath(dir), 'app')
  await mkdir(join(app, 'src'), { recursive: true })
  execFileSync('git', ['init', '-q', app])
  await writeFile(join(app, 'src', 'a.ts'), 'export const needle = 1\n')
  return [app, cleanup]
}

/** Runs `body` in the app with a one-project workspace, keeping the user's clipboard. */
async function withProject(
  body: (electronApp: ElectronApplication, page: Page, app: string) => Promise<void>
): Promise<void> {
  const [app, cleanProject] = await makeProject()
  const [userData, cleanUserData] = await seedWorkspace([{ path: app, kind: 'project' }])
  try {
    await withApp(
      async (electronApp, page) => {
        const restoreClipboard = await keepUserClipboard(electronApp)
        try {
          await body(electronApp, page, app)
        } finally {
          await restoreClipboard()
        }
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
    await cleanProject()
  }
}

test(
  'a right-click anywhere gives the text items; in a field also Cut and Paste',
  { tag: CLIPBOARD_TAG },
  async () => {
    await withProject(async (electronApp, page) => {
      await expect(page.getByRole('complementary', { name: 'Agents panel' })).toBeVisible()
      await page.keyboard.press('ControlOrMeta+Shift+KeyF')
      const panel = page.getByRole('complementary', { name: 'Find in Files panel' })
      const field = panel.getByRole('textbox', { name: 'Search text' })
      await expect(field).toBeFocused()
      await page.keyboard.type('needle draft')
      await expect(panel.getByRole('status')).toHaveText(/no matches/i)
      await page.keyboard.press('Shift+ControlOrMeta+ArrowLeft')

      await field.click({ button: 'right' })
      await expect(menuItems(page)).toHaveText([/^Cut/, /^Copy/, /^Paste/, /^Select All/])
      await menu(page).getByRole('menuitem', { name: /^Cut/ }).click()
      await expect(field).toHaveValue('needle ')
      await expect.poll(() => clipboardText(electronApp)).toBe('draft')
      await expect(field).toBeFocused()

      // The keyboard opens the same menu at the focused field.
      await page.keyboard.press('Shift+F10')
      await expect(menuItems(page)).toHaveText([/^Cut/, /^Copy/, /^Paste/, /^Select All/])
      await expect(menu(page).getByRole('menuitem', { name: /^Copy/ })).toBeDisabled()
      await menu(page)
        .getByRole('menuitem', { name: /^Paste/ })
        .click()
      await expect(field).toHaveValue('needle draft')

      // Plain text has Copy and Select All only, which stays in the panel clicked.
      await field.fill('needle')
      const summary = panel.getByRole('status')
      await expect(summary).toHaveText('1 match in 1 file')
      await summary.click({ button: 'right' })
      await expect(menuItems(page)).toHaveText([/^Copy/, /^Select All/])
      await menu(page)
        .getByRole('menuitem', { name: /^Select All/ })
        .click()
      await summary.click({ button: 'right' })
      await menu(page).getByRole('menuitem', { name: /^Copy/ }).click()
      await expect.poll(() => clipboardText(electronApp)).toContain('1 match in 1 file')
      expect(await clipboardText(electronApp)).not.toContain('Agents')
    })
  }
)
