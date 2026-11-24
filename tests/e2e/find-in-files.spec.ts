import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { editor, item, lines, openFile, showView, tab } from './editor-page'
import { makeTempDir, saveScreenshot, withApp } from './launch-app'
import { seedWorkspace } from './workspace-seed'

const panel = (page: Page) => page.getByRole('complementary', { name: 'Find in Files panel' })
const searchText = (page: Page) => panel(page).getByRole('textbox', { name: 'Search text' })
const results = (page: Page) => panel(page).getByRole('listbox', { name: 'Results' })
const summary = (page: Page) => panel(page).getByRole('status')
const option = (page: Page, name: string) => panel(page).getByRole('button', { name })

/** A git project with the word in its own files, an ignored folder and a dependency. */
async function makeProject(): Promise<[string, () => Promise<void>]> {
  const [dir, cleanup] = await makeTempDir('find-in-files')
  const app = join(await realpath(dir), 'app')
  await mkdir(join(app, 'src'), { recursive: true })
  await mkdir(join(app, 'dist'))
  await mkdir(join(app, 'node_modules', 'lib'), { recursive: true })
  execFileSync('git', ['init', '-q', app])
  await writeFile(join(app, '.gitignore'), 'dist/\n')
  await writeFile(join(app, 'src', 'a.ts'), 'export const needle = 1\n')
  await writeFile(
    join(app, 'src', 'b.ts'),
    '// b\n\nexport const needle = 3\nexport const Needles = 4\n'
  )
  await writeFile(join(app, 'dist', 'out.js'), 'needle\n')
  await writeFile(join(app, 'node_modules', 'lib', 'index.js'), 'needle\n')
  return [app, cleanup]
}

test('Find in Files searches the workspace and opens a result at its match', async () => {
  const [app, cleanProject] = await makeProject()
  const [userData, cleanUserData] = await seedWorkspace([{ path: app, kind: 'project' }])
  try {
    await withApp(
      async (_app, page) => {
        // The key works once the app is up.
        await expect(page.getByRole('complementary', { name: 'Agents panel' })).toBeVisible()
        await page.keyboard.press('ControlOrMeta+Shift+KeyF')
        await expect(searchText(page)).toBeFocused()
        await page.keyboard.type('needle')
        await expect(summary(page)).toHaveText('3 matches in 2 files')
        await expect(results(page).getByRole('option')).toHaveText([
          /export const needle = 1\s*1$/,
          /export const needle = 3\s*3$/,
          /export const Needles = 4\s*4$/
        ])

        // Options narrow it down; ignored files and dependencies only come in on request.
        await option(page, 'Match Case').click()
        await expect(summary(page)).toHaveText('2 matches in 2 files')
        await option(page, 'Include Non-Project Items').click()
        await expect(summary(page)).toHaveText('4 matches in 4 files')
        await panel(page).getByRole('textbox', { name: 'File mask' }).fill('*.ts')
        await expect(summary(page)).toHaveText('2 matches in 2 files')
        await saveScreenshot(page, 'find-in-files')

        // Down from the box into the results, Enter opens the file with the match selected.
        await searchText(page).press('ArrowDown')
        await expect(results(page)).toBeFocused()
        await page.keyboard.press('ArrowDown')
        await expect(results(page).getByRole('option', { selected: true })).toHaveAccessibleName(
          /^b\.ts line 3:/
        )
        await page.keyboard.press('Enter')
        await expect(tab(page, 'b.ts')).toHaveAttribute('aria-selected', 'true')
        // The editor takes the keys once the file is in; typing replaces the selected match.
        await expect(editor(page)).toHaveClass(/\bfocused\b/)
        await page.keyboard.type('pin')
        await expect(tab(page, 'b.ts, unsaved')).toBeVisible()
        await page.keyboard.press('ControlOrMeta+S')
        await expect(tab(page, 'b.ts')).toBeVisible()
        expect(await readFile(join(app, 'src', 'b.ts'), 'utf8')).toBe(
          '// b\n\nexport const pin = 3\nexport const Needles = 4\n'
        )

        await option(page, 'Regex').click()
        await searchText(page).fill('needle(')
        await expect(panel(page).getByRole('alert')).toHaveText(
          'Invalid regular expression: unclosed group'
        )
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
    await cleanProject()
  }
})

test("the key searches for the editor's selection from the Files view", async () => {
  const [app, cleanProject] = await makeProject()
  const [userData, cleanUserData] = await seedWorkspace([{ path: app, kind: 'project' }])
  try {
    await withApp(
      async (_app, page) => {
        await showView(page, 'Files')
        await openFile(page, 'app main', 'src', 'a.ts')
        await expect(tab(page, 'a.ts')).toHaveAttribute('aria-selected', 'true')
        await lines(page).click()
        await page.keyboard.press('ControlOrMeta+Home')
        await page.keyboard.press('Shift+End')
        await page.keyboard.press('ControlOrMeta+Shift+KeyF')
        await expect(searchText(page)).toHaveValue('export const needle = 1')
        await expect(searchText(page)).toBeFocused()
        await expect(summary(page)).toHaveText('1 match in 1 file')
        // The editor stays beside the results.
        await expect(tab(page, 'a.ts')).toBeVisible()
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
    await cleanProject()
  }
})

test('Find in Folder… searches only the folders chosen in the Files tree', async () => {
  const [app, cleanProject] = await makeProject()
  await mkdir(join(app, 'lib'))
  await writeFile(join(app, 'lib', 'c.ts'), 'export const needle = 5\n')
  const [userData, cleanUserData] = await seedWorkspace([{ path: app, kind: 'project' }])
  try {
    await withApp(
      async (_app, page) => {
        await showView(page, 'Files')
        await item(page, 'app main').click()
        await item(page, 'lib').click()
        await page.keyboard.press('ControlOrMeta+Shift+KeyF')
        await expect(searchText(page)).toBeFocused()
        await expect(panel(page)).toContainText('In lib')
        await page.keyboard.type('needle')
        await expect(summary(page)).toHaveText('1 match in 1 file')

        // Cleared, the scope is the whole workspace again.
        await option(page, 'Search the Whole Workspace').click()
        await expect(summary(page)).toHaveText('4 matches in 3 files')

        await showView(page, 'Files')
        await item(page, 'src').click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Find in Folder…' }).click()
        await expect(searchText(page)).toBeFocused()
        await expect(panel(page)).toContainText('In src')
        await expect(summary(page)).toHaveText('3 matches in 2 files')
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
    await cleanProject()
  }
})

test('results follow the workspace: a folder removed from it leaves them', async () => {
  const [app, cleanProject] = await makeProject()
  const other = join(app, '..', 'other')
  await mkdir(other)
  await writeFile(join(other, 'notes.txt'), 'needle\n')
  const [userData, cleanUserData] = await seedWorkspace([
    { path: app, kind: 'project' },
    { path: other, kind: 'folder' }
  ])
  try {
    await withApp(
      async (_app, page) => {
        await expect(page.getByRole('complementary', { name: 'Agents panel' })).toBeVisible()
        await page.keyboard.press('ControlOrMeta+Shift+KeyF')
        await page.keyboard.type('needle')
        await expect(summary(page)).toHaveText('4 matches in 3 files')

        await showView(page, 'Files')
        await item(page, 'other').click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Remove from Workspace' }).click()
        await expect(item(page, 'other')).toHaveCount(0)
        await page
          .getByRole('navigation', { name: 'Views' })
          .getByRole('button', { name: 'Find in Files' })
          .click()
        await expect(summary(page)).toHaveText('3 matches in 2 files')
        await expect(results(page).getByRole('group', { name: 'notes.txt' })).toHaveCount(0)
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
    await cleanProject()
  }
})
