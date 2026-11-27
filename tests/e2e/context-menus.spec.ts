import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { clickMenuItem } from './app-menu'
import { editor, item, openFile, showView, tab, tabs, typeAtEnd } from './editor-page'
import { makeTempDir, saveScreenshot, withApp } from './launch-app'
import { CLIPBOARD_TAG, keepUserClipboard } from './user-clipboard'
import { seedWorkspace } from './workspace-seed'

const menu = (page: Page) => page.locator('[data-slot=context-menu-content]')
const menuItems = (page: Page) => menu(page).getByRole('menuitem')
const clipboardText = (app: ElectronApplication) =>
  app.evaluate(({ clipboard }) => clipboard.readText())

async function makeProject(): Promise<[string, () => Promise<void>]> {
  const [dir, cleanup] = await makeTempDir('context-menus')
  const app = join(await realpath(dir), 'app')
  await mkdir(join(app, 'src'), { recursive: true })
  execFileSync('git', ['init', '-q', app])
  await writeFile(join(app, 'src', 'a.ts'), 'export const needle = 1\n')
  await writeFile(join(app, 'src', 'b.ts'), 'export const other = 2\n')
  await writeFile(
    join(app, 'README.md'),
    '# App\n\nRead [the docs](https://example.com/docs).\n\n```sh\npnpm verify\n```\n'
  )
  return [app, cleanup]
}

/** Runs `body` in the app with a one-project workspace, keeping the user's clipboard. */
async function withProject(
  body: (electronApp: ElectronApplication, page: Page, app: string) => Promise<void>,
  settings: Record<string, unknown> = {}
): Promise<void> {
  const [app, cleanProject] = await makeProject()
  const [userData, cleanUserData] = await seedWorkspace([{ path: app, kind: 'folder' }])
  await writeFile(
    join(userData, 'settings.json'),
    JSON.stringify({
      // As the launcher's own isolation: no real Hatfield runs in the test project.
      'agents.hatfield': { executable: 'hatfield-360-e2e-no-agent', args: [] },
      ...settings
    })
  )
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

test('notifications and settings rows have their own items', { tag: CLIPBOARD_TAG }, async () => {
  await withProject(
    async (electronApp, page) => {
      const toast = page
        .getByRole('region', { name: 'Notification toasts' })
        .getByRole('alert', { name: 'Settings' })
      await expect(toast).toContainText('"app.fontSize" must be a number.')
      await toast.getByText('"app.fontSize" must be a number.').click({ button: 'right' })
      await expect(menuItems(page)).toHaveText([
        'Copy Notification',
        'Close',
        /^Copy/,
        /^Select All/
      ])
      await saveScreenshot(page, 'context-menu-toast')
      await menu(page).getByRole('menuitem', { name: 'Copy Notification' }).click()
      await expect
        .poll(() => clipboardText(electronApp))
        .toMatch(/^Settings\n\n[^]*"app\.fontSize" must be a number\./)

      await page.getByRole('button', { name: /^Notifications(?: \(\d+\))?$/ }).click()
      const list = page.getByRole('list', { name: 'Notifications', exact: true })
      await list.getByRole('listitem').first().click({ button: 'right' })
      await expect(menuItems(page)).toHaveText([
        'Copy Notification',
        'Dismiss',
        'Dismiss All',
        /^Copy/,
        /^Select All/
      ])
      await menu(page).getByRole('menuitem', { name: 'Dismiss All' }).click()
      await expect(list).toHaveCount(0)
      await expect(toast).toHaveCount(0)

      // A customized setting resets from its row, as from its reset button.
      await clickMenuItem(electronApp, 'open-settings')
      const settings = page.getByRole('main', { name: 'Settings' })
      const gpu = settings.getByRole('checkbox', { name: /Terminal GPU rendering/ })
      await expect(gpu).not.toBeChecked()
      await gpu.click({ button: 'right' })
      await expect(menuItems(page)).toHaveText(['Reset to Default', /^Copy/, /^Select All/])
      await menu(page).getByRole('menuitem', { name: 'Reset to Default' }).click()
      await expect(gpu).toBeChecked()
    },
    { 'app.fontSize': 'big', 'terminal.gpuAcceleration': false }
  )
})

test('editor tabs and rendered Markdown have their own items', { tag: CLIPBOARD_TAG }, async () => {
  await withProject(async (electronApp, page) => {
    await showView(page, 'Files')
    await openFile(page, 'app', 'src', 'a.ts')
    await openFile(page, 'src', 'b.ts')
    await openFile(page, 'README.md')
    await expect(tabs(page)).toHaveCount(3)

    // Monaco keeps its own menu.
    await tab(page, 'b.ts').click()
    await editor(page).locator('.view-lines').click({ button: 'right' })
    await expect(page.getByText('Copy Reference')).toBeVisible()
    await expect(menu(page)).toHaveCount(0)
    await page.keyboard.press('Escape')

    await tab(page, 'a.ts').click({ button: 'right' })
    await expect(menuItems(page)).toHaveText([
      /^Close/,
      'Close Other Tabs',
      'Close Tabs to the Right',
      'Close All Tabs',
      /^Select Opened File/,
      /^Copy Path/,
      /^Copy Relative Path/,
      /^(Reveal in Finder|Show in File Manager)$/
    ])
    await menu(page)
      .getByRole('menuitem', { name: /^Copy Relative Path/ })
      .click()
    await expect.poll(() => clipboardText(electronApp)).toBe(join('src', 'a.ts'))

    await tab(page, 'b.ts').click({ button: 'right' })
    await menu(page).getByRole('menuitem', { name: 'Close Tabs to the Right' }).click()
    await expect(tabs(page)).toHaveText(['a.ts', 'b.ts'])

    // Closing several asks about each unsaved one, then closes the rest.
    await tab(page, 'a.ts').click()
    await typeAtEnd(page, '// draft')
    await tab(page, 'b.ts').click({ button: 'right' })
    await menu(page).getByRole('menuitem', { name: 'Close All Tabs' }).click()
    const ask = page.getByRole('alertdialog', { name: 'Save changes to a.ts?' })
    await expect(ask).toBeVisible()
    // The dialog hides the tabs behind it from the accessibility tree.
    const behindDialog = page
      .getByRole('tablist', { name: 'Editor tabs', includeHidden: true })
      .getByRole('tab', { includeHidden: true })
    await expect(behindDialog).toHaveText(['a.ts'])
    await ask.getByRole('button', { name: "Don't Save" }).click()
    await expect(tabs(page)).toHaveCount(0)

    // Rendered Markdown copies links and code.
    await openFile(page, 'README.md')
    await openFile(page, 'src', 'a.ts')
    await tab(page, 'README.md').click()
    await page.getByRole('button', { name: 'Preview' }).click()
    const preview = page.getByLabel('Markdown preview')
    await preview.getByRole('link', { name: 'the docs' }).click({ button: 'right' })
    await expect(menuItems(page)).toHaveText([
      'Open Link',
      'Copy Link Address',
      /^Copy/,
      /^Select All/
    ])
    await menu(page).getByRole('menuitem', { name: 'Copy Link Address' }).click()
    await expect.poll(() => clipboardText(electronApp)).toBe('https://example.com/docs')
    await preview.getByText('pnpm verify').click({ button: 'right' })
    await menu(page).getByRole('menuitem', { name: 'Copy Code' }).click()
    await expect.poll(() => clipboardText(electronApp)).toBe('pnpm verify\n')

    await tab(page, 'a.ts').click({ button: 'right' })
    await menu(page)
      .getByRole('menuitem', { name: /^Select Opened File/ })
      .click()
    await expect(item(page, 'a.ts')).toHaveAttribute('aria-selected', 'true')
    await expect(item(page, 'a.ts')).toBeFocused()
  })
})

test('search results and terminal tabs have their own items', { tag: CLIPBOARD_TAG }, async () => {
  await withProject(async (electronApp, page, app) => {
    // A Find in Files result opens and copies its file.
    await expect(page.getByRole('complementary', { name: 'Agents panel' })).toBeVisible()
    await page.keyboard.press('ControlOrMeta+Shift+KeyF')
    await page.keyboard.type('needle')
    const result = page
      .getByRole('listbox', { name: 'Results' })
      .getByRole('option', { name: /a\.ts line 1/ })
    await result.click({ button: 'right' })
    await expect(menuItems(page)).toHaveText([
      /^Open/,
      /^Copy Path/,
      /^Copy Relative Path/,
      /^(Reveal in Finder|Show in File Manager)$/
    ])
    await menu(page)
      .getByRole('menuitem', { name: /^Copy Path/ })
      .click()
    await expect.poll(() => clipboardText(electronApp)).toBe(join(app, 'src', 'a.ts'))

    // Terminal tabs close the same way.
    await showView(page, 'Agents')
    const newTerminal = page.getByRole('button', { name: 'New Terminal' })
    await page
      .getByRole('main', { name: 'Agents' })
      .getByRole('button', { name: 'New Terminal' })
      .click()
    const terminals = page.getByRole('tablist', { name: 'Terminals' }).getByRole('tab')
    await expect(terminals).toHaveCount(1)
    await newTerminal.click()
    await expect(terminals).toHaveCount(2)
    await terminals.first().click({ button: 'right' })
    await menu(page).getByRole('menuitem', { name: 'Close Other Tabs' }).click()
    await expect(terminals).toHaveCount(1)
  })
})
