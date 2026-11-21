import { expect, test, type Page } from '@playwright/test'
import { chmod, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { clickMenuItem } from './app-menu'
import { makeTempDir, saveScreenshot, withApp } from './launch-app'
import { seedWorkspace } from './workspace-seed'

const tree = (page: Page) => page.getByRole('tree', { name: 'Files' })
const item = (page: Page, name: string) => tree(page).getByRole('treeitem', { name, exact: true })
const tabs = (page: Page) => page.getByRole('tablist', { name: 'Editor tabs' }).getByRole('tab')
const tab = (page: Page, name: string) =>
  page.getByRole('tablist', { name: 'Editor tabs' }).getByRole('tab', { name, exact: true })
const editor = (page: Page) => page.locator('.monaco-editor')
const lines = (page: Page) => editor(page).locator('.view-lines')
const showView = (page: Page, name: 'Agents' | 'Files') =>
  page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name, exact: true }).click()

/** A plain folder `app` with two files of the same name and a few others. */
async function makeProject(): Promise<[string, () => Promise<void>]> {
  const [dir, cleanup] = await makeTempDir('editor')
  const app = join(await realpath(dir), 'app')
  await mkdir(join(app, 'src'), { recursive: true })
  await mkdir(join(app, 'test'))
  await writeFile(join(app, 'src', 'index.ts'), 'const greeting = "hello"\n')
  await writeFile(join(app, 'test', 'index.ts'), 'export const tested = true\n')
  await writeFile(join(app, 'notes.txt'), 'first line\n')
  await writeFile(join(app, 'broken.json'), '{ "name": }\n')
  return [app, cleanup]
}

/** Opens a file from the tree, expanding the folders on the way. */
async function openFile(page: Page, ...path: string[]): Promise<void> {
  for (const folder of path.slice(0, -1)) {
    if ((await item(page, folder).getAttribute('aria-expanded')) !== 'true') {
      await item(page, folder).click()
    }
  }
  await item(page, path.at(-1) ?? '').click()
}

/** Puts the caret at the end of the text and types there. */
async function typeAtEnd(page: Page, text: string): Promise<void> {
  await lines(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type(text)
}

test('files open in editor tabs that switch, reorder and close, with highlighting and running workers', async () => {
  const [app, cleanProject] = await makeProject()
  const [userData, cleanUserData] = await seedWorkspace([{ path: app, kind: 'folder' }])
  try {
    await withApp(
      async (_app, page) => {
        // Anything the CSP refuses, such as a worker started from a blob: URL, is logged.
        const refused: string[] = []
        page.on('console', (message) => {
          if (/Content Security Policy|Could not create web worker/i.test(message.text())) {
            refused.push(message.text())
          }
        })
        await showView(page, 'Files')
        await openFile(page, 'app', 'src', 'index.ts')
        await expect(tabs(page)).toHaveCount(1)
        await expect(lines(page)).toContainText('const greeting = "hello"')
        // Islands Dark's keyword colour, from the editor theme.
        await expect(lines(page).getByText('const', { exact: true })).toHaveCSS(
          'color',
          'rgb(207, 142, 109)'
        )

        // Two files of the same name show the folder that tells them apart.
        await item(page, 'test').click()
        await item(page, 'index.ts').last().click()
        await expect(tabs(page)).toHaveText(['index.tssrc', 'index.tstest'])
        await expect(tab(page, 'index.ts test')).toHaveAttribute('aria-selected', 'true')
        await expect(lines(page)).toContainText('export const tested = true')

        // Opening a file that is already open switches to its tab.
        await item(page, 'index.ts').first().click()
        await expect(tabs(page)).toHaveCount(2)
        await expect(tab(page, 'index.ts src')).toHaveAttribute('aria-selected', 'true')
        await expect(lines(page)).toContainText('const greeting')
        await tab(page, 'index.ts test').click()
        await expect(lines(page)).toContainText('export const tested')

        // The JSON worker runs and marks the syntax error.
        await openFile(page, 'broken.json')
        await expect(editor(page).locator('.squiggly-error')).not.toHaveCount(0)
        await saveScreenshot(page, 'editor-islands-dark')

        // Dragging a tab onto another puts it in that tab's place.
        await tab(page, 'broken.json').dragTo(tab(page, 'index.ts src'))
        await expect(tabs(page)).toHaveText(['broken.json', 'index.tssrc', 'index.tstest'])

        // Closing the active tab shows its right-hand neighbour; a lone name loses its folder.
        await tab(page, 'broken.json').click()
        await page.getByRole('button', { name: 'Close broken.json' }).click()
        await expect(tabs(page)).toHaveText(['index.tssrc', 'index.tstest'])
        await expect(tab(page, 'index.ts src')).toHaveAttribute('aria-selected', 'true')
        await page.getByRole('button', { name: 'Close index.ts test' }).click()
        await expect(tabs(page)).toHaveText(['index.ts'])
        await page.getByRole('button', { name: 'Close index.ts' }).click()
        await expect(tabs(page)).toHaveCount(0)
        await expect(page.getByText('Opened files will appear here in editor tabs.')).toBeVisible()
        expect(refused).toEqual([])
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
    await cleanProject()
  }
})

test('edits save to disk, survive switching views, and an unsaved tab asks before closing', async () => {
  const [app, cleanProject] = await makeProject()
  const notes = join(app, 'notes.txt')
  const onDisk = () => readFile(notes, 'utf8')
  const [userData, cleanUserData] = await seedWorkspace([{ path: app, kind: 'folder' }])
  try {
    await withApp(
      async (electronApp, page) => {
        await showView(page, 'Files')
        await openFile(page, 'app', 'notes.txt')
        await expect(lines(page)).toContainText('first line')
        await typeAtEnd(page, 'second line')
        await expect(tab(page, 'notes.txt, unsaved')).toBeVisible()

        // Unsaved edits and the tab stay while another view is shown.
        await showView(page, 'Agents')
        await expect(editor(page)).toBeHidden()
        await showView(page, 'Files')
        await expect(tab(page, 'notes.txt, unsaved')).toBeVisible()
        await expect(lines(page)).toContainText('second line')

        await lines(page).click()
        await page.keyboard.press('ControlOrMeta+S')
        await expect.poll(onDisk).toBe('first line\nsecond line')
        await expect(tab(page, 'notes.txt')).toBeVisible()

        // File > Save saves the active tab too.
        await typeAtEnd(page, '!')
        await clickMenuItem(electronApp, 'save-file')
        await expect.poll(onDisk).toBe('first line\nsecond line!')
        await expect(tab(page, 'notes.txt')).toBeVisible()

        // Closing with unsaved changes asks; Cancel keeps the tab and its changes.
        await typeAtEnd(page, ' draft')
        const close = page.getByRole('button', { name: 'Close notes.txt' })
        const dialog = page.getByRole('alertdialog', { name: 'Save changes to notes.txt?' })
        await close.click()
        await expect(dialog).toBeVisible()
        await dialog.getByRole('button', { name: 'Cancel' }).click()
        await expect(dialog).toBeHidden()
        await expect(lines(page)).toContainText('second line! draft')

        // Don't Save closes the tab and leaves the file as it was.
        await close.click()
        await dialog.getByRole('button', { name: "Don't Save" }).click()
        await expect(tabs(page)).toHaveCount(0)
        expect(await onDisk()).toBe('first line\nsecond line!')
        await openFile(page, 'notes.txt')
        await expect(lines(page)).toContainText('second line!')
        await expect(lines(page)).not.toContainText('draft')

        // Save writes the changes, then closes the tab.
        await typeAtEnd(page, ' kept')
        await page.getByRole('button', { name: 'Close notes.txt' }).click()
        await dialog.getByRole('button', { name: 'Save', exact: true }).click()
        await expect(tabs(page)).toHaveCount(0)
        expect(await onDisk()).toBe('first line\nsecond line! kept')
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
    await cleanProject()
  }
})

test('a failed save says why and keeps the changes', async () => {
  // A read-only folder refuses the new file; Windows has no such folder mode, and root ignores it.
  test.skip(process.platform === 'win32' || process.getuid?.() === 0, 'needs folder permissions')
  const [app, cleanProject] = await makeProject()
  const [userData, cleanUserData] = await seedWorkspace([{ path: app, kind: 'folder' }])
  try {
    await withApp(
      async (_app, page) => {
        await showView(page, 'Files')
        await openFile(page, 'app', 'notes.txt')
        await typeAtEnd(page, 'unsaved')
        await chmod(app, 0o555)
        try {
          await page.keyboard.press('ControlOrMeta+S')
          await expect(page.getByText("Couldn't save notes.txt").first()).toBeVisible()
          await expect(tab(page, 'notes.txt, unsaved')).toBeVisible()
          await expect(lines(page)).toContainText('first lineunsaved')
        } finally {
          await chmod(app, 0o755)
        }
        expect(await readFile(join(app, 'notes.txt'), 'utf8')).toBe('first line\n')
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
    await cleanProject()
  }
})

test('the editor follows the editor theme and font settings as they change', async () => {
  const [app, cleanProject] = await makeProject()
  const [userData, cleanUserData] = await seedWorkspace([{ path: app, kind: 'folder' }])
  try {
    await withApp(
      async (_app, page) => {
        const background = editor(page).locator('.monaco-editor-background')
        await showView(page, 'Files')
        await openFile(page, 'app', 'src', 'index.ts')
        // The TEXT background of the Islands Dark editor scheme, then of Light.
        await expect(background).toHaveCSS('background-color', 'rgb(25, 26, 28)')

        await writeFile(
          join(userData, 'settings.json'),
          JSON.stringify({
            'workbench.colorTheme': 'islands-light',
            'editor.colorTheme': 'light',
            'editor.fontSize': 16
          })
        )
        await expect(background).toHaveCSS('background-color', 'rgb(255, 255, 255)')
        await expect(lines(page)).toHaveCSS('font-size', '16px')
        await saveScreenshot(page, 'editor-light')
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
    await cleanProject()
  }
})
