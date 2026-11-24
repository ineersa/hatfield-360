import { expect, test, type Page } from '@playwright/test'
import { parse } from 'jsonc-parser'
import { mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { lines, openFile, showView, tab, tabs } from './editor-page'
import { makeTempDir, saveScreenshot, withApp } from './launch-app'
import { seedWorkspace } from './workspace-seed'

const mac = process.platform === 'darwin'
// JetBrains' keys, as Playwright presses them.
const keys = {
  save: 'ControlOrMeta+S',
  goToLine: mac ? 'Meta+KeyL' : 'Control+KeyG',
  fileStructure: mac ? 'Meta+F12' : 'Control+F12',
  duplicate: mac ? 'Meta+D' : 'Control+D',
  deleteLine: mac ? 'Meta+Backspace' : 'Control+Y',
  comment: mac ? 'Meta+Slash' : 'Control+Slash',
  moveLineDown: 'Alt+Shift+ArrowDown',
  extendSelection: mac ? 'Alt+ArrowUp' : 'Control+KeyW',
  shrinkSelection: mac ? 'Alt+ArrowDown' : 'Control+Shift+KeyW',
  closeTab: mac ? 'Meta+KeyW' : 'Control+F4',
  nextTab: mac ? 'Meta+Shift+BracketRight' : 'Alt+ArrowRight',
  previousTab: mac ? 'Meta+Shift+BracketLeft' : 'Alt+ArrowLeft',
  splitRight: mac ? 'Meta+KeyD' : 'Control+Shift+KeyD',
  closePane: mac ? 'Meta+KeyW' : 'Control+Shift+KeyW'
}

const panes = (page: Page) => page.getByTestId('terminal-pane')

const SOURCE = ['const first = 1', 'const second = call(alpha.beta)', 'const third = 3', '']

async function makeProject(): Promise<[string, () => Promise<void>]> {
  const [dir, cleanup] = await makeTempDir('keymap')
  const app = join(await realpath(dir), 'app')
  await mkdir(app)
  await writeFile(join(app, 'keys.ts'), SOURCE.join('\n'))
  await writeFile(join(app, 'other.ts'), 'export const other = 1\n')
  return [app, cleanup]
}

/** Go to Line: its picker takes the number and closes on Enter. */
/** The status bar's caret: `line:column`, and how much is selected. */
const caret = (page: Page) => page.getByRole('status', { name: 'Caret position' })

async function goToLine(page: Page, line: number): Promise<void> {
  await page.keyboard.press(keys.goToLine)
  const picker = page.locator('.quick-input-widget')
  await expect(picker).toBeVisible()
  await page.keyboard.type(String(line))
  await page.keyboard.press('Enter')
  await expect(picker).toBeHidden()
}

test('the editor runs JetBrains actions on their keys', async () => {
  const [app, cleanProject] = await makeProject()
  const [userData, cleanUserData] = await seedWorkspace([{ path: app, kind: 'folder' }])
  /** Saves the edit with the keyboard, then reads the file once its tab no longer shows unsaved changes. */
  const saved = async (page: Page): Promise<string[]> => {
    // Unsaved first: the edit has reached the tab, so the saved label below follows this save.
    await expect(tab(page, 'keys.ts, unsaved')).toBeVisible()
    await page.keyboard.press(keys.save)
    await expect(tab(page, 'keys.ts')).toBeVisible()
    return (await readFile(join(app, 'keys.ts'), 'utf8')).split('\n')
  }
  try {
    await withApp(
      async (_app, page) => {
        const errors: string[] = []
        page.on('console', (message) => {
          if (message.type() === 'error') errors.push(message.text())
        })
        await showView(page, 'Files')
        await openFile(page, 'app', 'keys.ts')
        await expect(lines(page)).toContainText('const third = 3')
        await lines(page).click()
        // The status bar describes the file as JetBrains does.
        await expect(page.getByLabel('Line separator')).toHaveText('LF')
        await expect(page.getByLabel('File encoding')).toHaveText('UTF-8')

        await goToLine(page, 2)
        await page.keyboard.press(keys.duplicate)
        expect(await saved(page)).toEqual([
          'const first = 1',
          'const second = call(alpha.beta)',
          'const second = call(alpha.beta)',
          'const third = 3',
          ''
        ])

        await page.keyboard.press(keys.deleteLine)
        expect(await saved(page)).toEqual(SOURCE)

        await goToLine(page, 1)
        await page.keyboard.press(keys.comment)
        expect(await saved(page)).toEqual([
          '// const first = 1',
          'const second = call(alpha.beta)',
          'const third = 3',
          ''
        ])

        await page.keyboard.press(keys.moveLineDown)
        expect(await saved(page)).toEqual([
          'const second = call(alpha.beta)',
          '// const first = 1',
          'const third = 3',
          ''
        ])

        // From inside `beta`: the word, then `alpha.beta`, which typing replaces.
        await goToLine(page, 1)
        await page.keyboard.press('End')
        await page.keyboard.press('ArrowLeft')
        await page.keyboard.press('ArrowLeft')
        // Each step asks the language server; the status bar shows when it is in.
        await page.keyboard.press(keys.extendSelection)
        await expect(caret(page)).toHaveText('1:31 (4 chars)')
        await page.keyboard.press(keys.extendSelection)
        await expect(caret(page)).toHaveText('1:31 (10 chars)')
        await page.keyboard.press(keys.extendSelection)
        await expect(caret(page)).toHaveText('1:32 (16 chars)')
        await page.keyboard.press(keys.shrinkSelection)
        await expect(caret(page)).toHaveText('1:31 (10 chars)')
        await page.keyboard.type('replaced')
        expect(await saved(page)).toEqual([
          'const second = call(replaced)',
          '// const first = 1',
          'const third = 3',
          ''
        ])

        // File Structure lists the file's symbols; Escape closes it.
        await page.keyboard.press(keys.fileStructure)
        const picker = page.locator('.quick-input-widget')
        await expect(picker).toBeVisible()
        await expect(picker.locator('input')).toHaveValue('@')
        await saveScreenshot(page, 'editor-file-structure')
        await page.keyboard.press('Escape')
        await expect(picker).toBeHidden()
        // Every command the keymap names exists.
        expect(errors.filter((error) => error.startsWith('Editor keymap'))).toEqual([])
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
    await cleanProject()
  }
})

test('a key the terminal shares acts where the keys are; editor tabs close and switch on their keys', async () => {
  const [app, cleanProject] = await makeProject()
  const [userData, cleanUserData] = await seedWorkspace([{ path: app, kind: 'project' }])
  await writeFile(join(userData, 'settings.json'), '{ "terminal.gpuAcceleration": false }')
  try {
    await withApp(
      async (_app, page) => {
        // The app opens on the Agents view.
        await page
          .getByRole('list', { name: 'Workspace folders' })
          .getByRole('listitem', { name: 'app', exact: true })
          .click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Open Terminal Here' }).click()
        await expect(panes(page)).toHaveCount(1)

        await showView(page, 'Files')
        await openFile(page, 'app', 'keys.ts')
        await openFile(page, 'app', 'other.ts')
        await expect(tab(page, 'other.ts')).toHaveAttribute('aria-selected', 'true')
        await lines(page).click()
        await page.keyboard.press(keys.previousTab)
        await expect(tab(page, 'keys.ts')).toHaveAttribute('aria-selected', 'true')
        await page.keyboard.press(keys.nextTab)
        await expect(tab(page, 'other.ts')).toHaveAttribute('aria-selected', 'true')
        // From the last tab, the next is the first.
        await page.keyboard.press(keys.nextTab)
        await expect(tab(page, 'keys.ts')).toHaveAttribute('aria-selected', 'true')

        // The terminal's key runs the editor's action in the editor: Duplicate on macOS,
        // Shrink Selection elsewhere.
        await page.keyboard.press('ControlOrMeta+Home')
        await page.keyboard.press('End')
        if (mac) {
          await page.keyboard.press(keys.splitRight)
        } else {
          await page.keyboard.press(keys.extendSelection)
          await expect(caret(page)).toHaveText('1:16 (1 char)')
          await page.keyboard.press(keys.extendSelection)
          await expect(caret(page)).toHaveText('1:16 (15 chars)')
          await page.keyboard.press(keys.closePane)
          await expect(caret(page)).toHaveText('1:16 (1 char)')
          await page.keyboard.type('one')
        }
        await expect(tab(page, 'keys.ts, unsaved')).toBeVisible()
        await page.keyboard.press(keys.save)
        await expect(tab(page, 'keys.ts')).toBeVisible()
        expect((await readFile(join(app, 'keys.ts'), 'utf8')).split('\n').slice(0, 2)).toEqual(
          mac ? ['const first = 1', 'const first = 1'] : ['const first = one', SOURCE[1]]
        )

        await page.keyboard.press(keys.closeTab)
        await expect(tabs(page)).toHaveText(['other.ts'])

        // In the terminal the same keys split and close its panes.
        await showView(page, 'Agents')
        await panes(page).click()
        await page.keyboard.press(keys.splitRight)
        await expect(panes(page)).toHaveCount(2)
        await page.keyboard.press(keys.closePane)
        await expect(panes(page)).toHaveCount(1)
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
    await cleanProject()
  }
})

test('keybindings.json opens from Settings with every default listed, and rebinds keys on save', async () => {
  const [app, cleanProject] = await makeProject()
  const [userData, cleanUserData] = await seedWorkspace([{ path: app, kind: 'folder' }])
  const rebound = mac
    ? { duplicate: 'cmd+alt+d', closeTab: 'cmd+alt+w', settings: 'cmd+alt+shift+s' }
    : { duplicate: 'ctrl+alt+d', closeTab: 'ctrl+alt+w', settings: 'ctrl+alt+shift+s' }
  const entries = [
    { key: rebound.duplicate, command: 'editor.action.duplicateSelection' },
    { key: mac ? 'cmd+d' : 'ctrl+d', command: '-editor.action.duplicateSelection' },
    { key: rebound.closeTab, command: 'hatfield.editor.closeTab' },
    { key: rebound.settings, command: 'hatfield.settings' }
  ]
  const keybindings = join(userData, 'keybindings.json')
  try {
    await withApp(
      async (electronApp, page) => {
        await page.getByRole('button', { name: 'Settings', exact: true }).click()
        await page.getByRole('button', { name: 'Open keybindings.json' }).click()
        await expect(tab(page, 'keybindings.json')).toHaveAttribute('aria-selected', 'true')
        await expect(lines(page)).toContainText('// Hatfield 360 keybindings.')
        await expect(lines(page)).toContainText('editor.action.duplicateSelection')
        await saveScreenshot(page, 'keybindings-json')

        // Each entry typed on the line after `[`; the editor's closing brackets and quotes are typed over.
        await lines(page).click()
        const opening = (await readFile(keybindings, 'utf8')).split('\n').indexOf('[') + 1
        await goToLine(page, opening)
        await page.keyboard.press('End')
        for (const entry of entries) {
          await page.keyboard.press('Enter')
          await page.keyboard.type(`{ "key": "${entry.key}", "command": "${entry.command}" },`)
        }
        await page.keyboard.press(keys.save)
        // The tab's close button shows the key once the app has read the saved file.
        await expect(page.getByRole('button', { name: 'Close keybindings.json' })).toHaveAttribute(
          'title',
          mac ? 'Close (⌥⌘W)' : 'Close (Ctrl+Alt+W)'
        )
        expect(
          parse(await readFile(keybindings, 'utf8'), [], { allowTrailingComma: true })
        ).toEqual(entries)
        expect(
          await electronApp.evaluate(
            ({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('open-settings')?.accelerator
          )
        ).toBe(mac ? 'Command+Alt+Shift+S' : 'Ctrl+Alt+Shift+S')

        // The old Duplicate key does nothing; the new one duplicates.
        await openFile(page, 'app', 'keys.ts')
        await expect(lines(page)).toContainText('const third = 3')
        await lines(page).click()
        await goToLine(page, 1)
        await page.keyboard.press(keys.duplicate)
        await page.keyboard.press(mac ? 'Meta+Alt+KeyD' : 'Control+Alt+KeyD')
        await expect(tab(page, 'keys.ts, unsaved')).toBeVisible()
        await page.keyboard.press(keys.save)
        await expect(tab(page, 'keys.ts')).toBeVisible()
        expect((await readFile(join(app, 'keys.ts'), 'utf8')).split('\n')).toEqual([
          'const first = 1',
          ...SOURCE
        ])

        // The rebound Close Tab key closes the tab.
        await page.keyboard.press(mac ? 'Meta+Alt+KeyW' : 'Control+Alt+KeyW')
        await expect(tabs(page)).toHaveText(['keybindings.json'])
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
    await cleanProject()
  }
})

test('a keybindings.json that links to another file does not open in the editor', async () => {
  const [app, cleanProject] = await makeProject()
  const [userData, cleanUserData] = await seedWorkspace([{ path: app, kind: 'folder' }])
  // Outside the workspace: the link must not make it editable.
  const elsewhere = join(app, '..', 'elsewhere.json')
  await writeFile(elsewhere, '[]\n')
  await symlink(elsewhere, join(userData, 'keybindings.json'))
  try {
    await withApp(
      async (_electronApp, page) => {
        await page.getByRole('button', { name: 'Settings', exact: true }).click()
        await page.getByRole('button', { name: 'Open keybindings.json' }).click()
        await expect(tab(page, 'keybindings.json')).toHaveAttribute('aria-selected', 'true')
        await expect(page.getByRole('main', { name: 'Files' }).getByRole('alert')).toContainText(
          "Couldn't open keybindings.json"
        )
        await expect(lines(page)).toBeHidden()
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
    await cleanProject()
  }
})
