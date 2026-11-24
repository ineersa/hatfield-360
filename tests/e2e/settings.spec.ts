import { expect, test, type Page } from '@playwright/test'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse } from 'jsonc-parser'
import { clickMenuItem, submenuLabels } from './app-menu'
import { makeTempDir, saveScreenshot, withApp } from './launch-app'

const settingsMain = (page: Page) => page.getByRole('main', { name: 'Settings' })
/** A toast in the bottom-right corner, named by its title. */
const toast = (page: Page, title: string) =>
  page.getByRole('region', { name: 'Notification toasts' }).getByRole('alert', { name: title })
const message = (page: Page) => toast(page, 'Settings')
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
        await message(page).getByRole('button', { name: 'Close' }).click()
        await expect(message(page)).toHaveCount(0)

        // Bad values are ignored one by one; the good ones apply.
        await writeFile(settings, '{ "app.fontSize": "big", "workbench.iconTheme": "lucide" }')
        await expect(
          message(page).getByText('"app.fontSize" must be a number.', { exact: true })
        ).toBeVisible()
        await expect(projectIcon(page, folderName)).toHaveAttribute('data-icon-theme', 'lucide')
        await expectAppFont(page, /^"Inter Variable"/, '12px', '10px')

        // Without the file every setting is back at its default.
        await rm(settings)
        await expect(message(page)).toHaveCount(0)
        await expectAppFont(page, /^"Inter Variable"/, '14px', '12px')
        await expect(projectIcon(page, folderName)).toHaveAttribute('data-icon-theme', 'catppuccin')

        expect(await submenuLabels(app, 'preferences')).toEqual([
          'Settings',
          'Open Settings (JSON)',
          'Open Keybindings (JSON)'
        ])
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
    await cleanProjects()
  }
})

test('the Settings page applies each change as it is made and writes it into settings.json', async () => {
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
  const readSettings = async (): Promise<unknown> => parse(await readFile(settings, 'utf8'))
  try {
    await withApp(
      async (app, page) => {
        // A person uses the menu once the window shows its content, so the page is listening by then.
        await expect(page.getByRole('list', { name: 'Workspace folders' })).toBeVisible()
        await clickMenuItem(app, 'open-settings')
        const settingsPage = settingsMain(page)
        await expect(settingsPage.getByRole('heading', { name: 'Settings' })).toBeVisible()
        await expect(settingsPage.getByLabel('App font family', { exact: true })).toHaveText(
          'Noto Sans'
        )

        // Sizes apply while typing, without Enter or leaving the field.
        await settingsPage.getByLabel('App font size', { exact: true }).fill('16')
        await expect(page.locator('body')).toHaveCSS('font-size', '16px')
        // Escape drops what was typed, even before it would have applied.
        await settingsPage.getByLabel('App font size', { exact: true }).fill('20')
        await page.keyboard.press('Escape')
        await expect(settingsPage.getByLabel('App font size', { exact: true })).toHaveValue('16')
        await expect(settingsPage).toBeVisible()
        await settingsPage.getByRole('button', { name: 'Increase Terminal font size' }).click()
        await expect(settingsPage.getByLabel('Terminal font size', { exact: true })).toHaveValue(
          '16'
        )
        await expect
          .poll(() => readFile(settings, 'utf8'))
          .toBe(
            '{\n  // my terminal\n  "terminal.fontSize": 16,\n  "app.fontFamily": "Noto Sans",\n  "app.fontSize": 16\n}\n'
          )

        // Line height steps by 0.1 and shows on the font preview: 1.3 × 13px.
        await settingsPage.getByRole('button', { name: 'Increase Editor line height' }).click()
        await expect(settingsPage.getByLabel('Editor line height', { exact: true })).toHaveValue(
          '1.3'
        )
        await expect(settingsPage.getByLabel('Editor font preview')).toHaveCSS(
          'line-height',
          '16.9px'
        )
        await expect.poll(readSettings).toMatchObject({ 'editor.lineHeight': 1.3 })
        await settingsPage.getByRole('button', { name: 'Reset Editor line height' }).click()
        await expect(settingsPage.getByLabel('Editor line height', { exact: true })).toHaveValue(
          '1.2'
        )
        await expect.poll(readSettings).not.toHaveProperty(['editor.lineHeight'])

        await settingsPage.getByText('Lucide', { exact: true }).click()
        await expect(projectIcon(page, folderName)).toHaveAttribute('data-icon-theme', 'lucide')

        // The picker lists the installed fonts; picking one applies it.
        await settingsPage.getByRole('button', { name: 'App font family', exact: true }).click()
        const fonts = page.getByRole('listbox', { name: 'Fonts' })
        await expect(fonts.getByRole('option')).not.toHaveCount(1)
        await saveScreenshot(page, 'settings-font-picker')
        const installed = fonts.getByRole('option').nth(1)
        const family = (await installed.locator('span').first().textContent()) ?? ''
        await installed.click()
        await expect(fonts).toHaveCount(0)
        // Chromium drops the quotes around a name that is a single CSS identifier (Arial, C059).
        const name = family.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        await expect(page.locator('body')).toHaveCSS(
          'font-family',
          new RegExp(`^"?${name}"?, "Inter Variable", system-ui, sans-serif$`)
        )
        await expect.poll(readSettings).toMatchObject({ 'app.fontFamily': family })
        await saveScreenshot(page, 'settings-page')

        // Anything typed in the search can be used, e.g. a font stack; Escape there closes only the picker.
        await settingsPage.getByRole('button', { name: 'Editor font family', exact: true }).click()
        await page.getByRole('combobox', { name: 'Search fonts' }).fill('My Mono, monospace')
        await page.getByRole('option', { name: 'Use “My Mono, monospace”' }).click()
        await expect.poll(readSettings).toMatchObject({ 'editor.fontFamily': 'My Mono, monospace' })
        await settingsPage
          .getByRole('button', { name: 'Terminal font family', exact: true })
          .click()
        await expect(page.getByRole('combobox', { name: 'Search fonts' })).toBeFocused()
        await page.keyboard.press('Escape')
        await expect(fonts).toHaveCount(0)
        await expect(settingsPage).toBeVisible()
        await saveScreenshot(page, 'settings-page-custom')

        await settingsPage.getByRole('button', { name: 'Reset App font family' }).click()
        await expect(page.locator('body')).toHaveCSS('font-family', /^"Inter Variable"/)
        await expect.poll(readSettings).toEqual({
          'terminal.fontSize': 16,
          'app.fontSize': 16,
          'workbench.iconTheme': 'lucide',
          'editor.fontFamily': 'My Mono, monospace'
        })

        // Reset all asks first, then puts every setting back, the icon set included.
        await expect(settingsPage.getByRole('button', { name: 'Reset File icons' })).toBeVisible()
        await settingsPage.getByRole('button', { name: 'Reset all to defaults' }).click()
        await settingsPage.getByRole('button', { name: 'Cancel' }).click()
        await expect(projectIcon(page, folderName)).toHaveAttribute('data-icon-theme', 'lucide')
        await settingsPage.getByRole('button', { name: 'Reset all to defaults' }).click()
        await settingsPage
          .getByRole('group', { name: 'Reset all settings' })
          .getByRole('button', { name: 'Reset' })
          .click()
        await expect(projectIcon(page, folderName)).toHaveAttribute('data-icon-theme', 'catppuccin')
        await expect(page.locator('body')).toHaveCSS('font-size', '14px')
        await expect.poll(readSettings).toEqual({})
        await expect(
          settingsPage.getByRole('button', { name: 'Reset all to defaults' })
        ).toHaveCount(0)

        // Edits to the file show up on the open page; a broken file locks it.
        await writeFile(settings, '{ "terminal.fontSize": 18 }')
        await expect(settingsPage.getByLabel('Terminal font size', { exact: true })).toHaveValue(
          '18'
        )
        await expect(settingsPage.getByLabel('App font size', { exact: true })).toHaveValue('14')
        await writeFile(settings, '{ "terminal.fontSize": ')
        await expect(
          settingsPage.getByRole('status', { name: 'Settings file errors' })
        ).toContainText('settings.json has errors')
        await expect(settingsPage.getByLabel('Terminal font size', { exact: true })).toBeDisabled()

        // Only the font list permission is granted to the page.
        expect(
          await page.evaluate(
            "Promise.all(['local-fonts', 'notifications', 'geolocation'].map((name) => navigator.permissions.query({ name }).then((status) => status.state)))"
          )
        ).toEqual(['granted', 'denied', 'denied'])

        await page.keyboard.press('Escape')
        await expect(settingsMain(page)).toHaveCount(0)
        await page.getByRole('button', { name: 'Settings', exact: true }).click()
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

test('a settings.json that could not be read at launch is read again once it is fixed', async () => {
  const [userData, cleanUserData] = await makeTempDir('user-data')
  const settings = join(userData, 'settings.json')
  await mkdir(settings)
  try {
    await withApp(
      async (_app, page) => {
        await expect(message(page)).toContainText('EISDIR')
        await rm(settings, { recursive: true })
        await writeFile(settings, '{ "app.fontSize": 20 }')
        await expect(page.locator('body')).toHaveCSS('font-size', '20px')
        // A fresh page asks main again and must get the fixed file, not the first failure.
        await page.reload()
        await expect(page.locator('body')).toHaveCSS('font-size', '20px')
        await expect(message(page)).toHaveCount(0)
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
  }
})

test('the largest app font in the smallest window keeps the status bar and Settings page in the window', async () => {
  const [userData, cleanUserData] = await makeTempDir('user-data')
  await writeFile(join(userData, 'settings.json'), '{ "app.fontSize": 32 }')
  try {
    await withApp(
      async (app, page) => {
        await app.evaluate(({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows()[0]
          if (!window) throw new Error('no window')
          window.setContentSize(600, 400)
        })
        await expect.poll(() => page.evaluate('window.innerHeight')).toBeLessThan(420)
        await expect(page.locator('body')).toHaveCSS('font-size', '32px')
        const gear = page.getByRole('button', { name: 'Settings', exact: true })
        const gearBox = await gear.boundingBox()
        const footerBox = await page.locator('footer').boundingBox()
        if (!gearBox || !footerBox) throw new Error('layout is not rendered')
        expect(gearBox.y + gearBox.height).toBeLessThanOrEqual(footerBox.y)
        // The activity bar widens with its buttons, so none is cut off by the window or the panel.
        const bar = page.getByRole('navigation', { name: 'Views' })
        const barBox = await bar.boundingBox()
        if (!barBox) throw new Error('activity bar is not rendered')
        expect(barBox.x).toBeGreaterThanOrEqual(0)
        for (const button of await bar.getByRole('button').all()) {
          const box = await button.boundingBox()
          if (!box) throw new Error('activity button is not rendered')
          expect(box.x).toBeGreaterThanOrEqual(barBox.x)
          expect(box.x + box.width).toBeLessThanOrEqual(barBox.x + barBox.width)
        }
        // Text line heights are fractional; allow under a pixel of rounding at the window edge.
        expect(footerBox.y + footerBox.height).toBeLessThan(
          Number(await page.evaluate('window.innerHeight')) + 1
        )
        // A toast narrows to fit beside the activity bar instead of running off the window.
        await writeFile(
          join(userData, 'settings.json'),
          '{ "app.fontSize": 32, "editor.lineHeight": 5 }'
        )
        await expect(message(page)).toBeVisible()
        const toastBox = await message(page).boundingBox()
        if (!toastBox) throw new Error('toast is not rendered')
        expect(toastBox.x).toBeGreaterThanOrEqual(barBox.x + barBox.width)
        expect(toastBox.x + toastBox.width).toBeLessThanOrEqual(
          Number(await page.evaluate('window.innerWidth'))
        )
        await saveScreenshot(page, 'toast-font-32-small-window')
        await message(page).getByRole('button', { name: 'Close' }).click()

        await gear.click()
        await expect(settingsMain(page)).toBeVisible()
        // Nothing on the Settings page makes the whole window scroll sideways.
        expect(await page.evaluate('document.documentElement.scrollWidth')).toBe(
          await page.evaluate('window.innerWidth')
        )
        await saveScreenshot(page, 'settings-font-32-small-window')
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
  }
})

test('agent sound choices and mute survive restart, and selected sounds preview while muted', async () => {
  const [userDataDir, cleanup] = await makeTempDir('agent-sounds')
  const choices = [
    ['Completed', 'Desk bell'],
    ['Needs input', 'Triple pulse'],
    ['Failed', 'Falling whistle']
  ] as const
  try {
    await withApp(
      async (_app, page) => {
        await page.getByRole('button', { name: 'Settings', exact: true }).click()
        const settings = settingsMain(page)
        const mute = settings.getByRole('checkbox', { name: 'Agent notification sounds' })
        await expect(mute).toBeChecked()
        await mute.uncheck()
        for (const [cue, sound] of choices) {
          const picker = settings.getByRole('button', { name: new RegExp(`^${cue} sound:`) })
          await picker.press('Enter')
          const option = page
            .getByRole('dialog', { name: `${cue} sound` })
            .getByRole('button', { name: sound, exact: true })
          await option.press('Enter')
          await expect(picker).toHaveAccessibleName(`${cue} sound: ${sound}`)
          await settings.getByRole('button', { name: `Preview ${cue}`, exact: true }).click()
          await expect(settings.getByRole('status', { name: 'Sound preview result' })).toHaveText(
            `${cue} preview finished: ${sound}.`
          )
        }
        await expect(
          page.evaluate(() =>
            Reflect.apply(globalThis.desktop.updateSetting, undefined, [
              'notifications.completedSound',
              'not-a-preset'
            ])
          )
        ).rejects.toThrow(/must be one of/)
        expect(parse(await readFile(join(userDataDir, 'settings.json'), 'utf8'))).toMatchObject({
          'notifications.agentSounds': false,
          'notifications.completedSound': 'bell',
          'notifications.needsInputSound': 'pulse',
          'notifications.failedSound': 'falling-whistle'
        })
      },
      { userDataDir }
    )
    await withApp(
      async (_app, page) => {
        await page.getByRole('button', { name: 'Settings', exact: true }).click()
        await expect(
          settingsMain(page).getByRole('checkbox', { name: 'Agent notification sounds' })
        ).not.toBeChecked()
        for (const [cue, sound] of choices) {
          await expect(
            settingsMain(page).getByRole('button', { name: `${cue} sound: ${sound}`, exact: true })
          ).toBeVisible()
        }
      },
      { userDataDir }
    )
  } finally {
    await cleanup()
  }
})
