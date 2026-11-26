import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { editor, item, showView, tab } from './editor-page'
import { makeTempDir, saveScreenshot, withApp } from './launch-app'
import { seedWorkspace } from './workspace-seed'

// Classes and symbols come from language servers, whose speed varies with load: not tested here.

const popup = (page: Page) => page.getByRole('dialog', { name: 'Search Everywhere' })
const searchBox = (page: Page) => popup(page).getByRole('combobox', { name: 'Search Everywhere' })
const results = (page: Page) => popup(page).getByRole('option')

const mac = process.platform === 'darwin'

/**
 * Go to File's key. Shift Shift opens the same popup but within a time window, which a loaded
 * machine can miss; its detection is unit-tested instead.
 */
async function goToFile(page: Page): Promise<void> {
  await page.keyboard.press(mac ? 'Meta+Shift+KeyO' : 'Control+Shift+KeyN')
}

/** A git project with nested PHP files, a git-ignored build and a dependency holding a same-named file. */
async function makeProject(): Promise<[string, () => Promise<void>]> {
  const [dir, cleanup] = await makeTempDir('search-everywhere')
  const app = join(await realpath(dir), 'app')
  const files: Record<string, string> = {
    '.gitignore': 'build/\n',
    'src/AgentCore/Application/Pipeline/RunMessageProcessor.php':
      '<?php\n\nclass RunMessageProcessor {}\n',
    'src/AgentCore/Application/Pipeline/MessageProcessor.php': '<?php\n',
    'tests/Unit/Pipeline/RunMessageProcessorTest.php': '<?php\n',
    'build/RunMessageProcessor.php': '<?php\n',
    'vendor/acme/src/RunMessageProcessor.php': '<?php\n'
  }
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(app, path)), { recursive: true })
    await writeFile(join(app, path), text)
  }
  execFileSync('git', ['init', '-q', app])
  return [app, cleanup]
}

test('Search Everywhere finds a file from a path fragment and Enter opens it; Esc gives the keys back', async () => {
  const [app, cleanProject] = await makeProject()
  const [userData, cleanUserData] = await seedWorkspace([{ path: app, kind: 'project' }])
  try {
    await withApp(
      async (_app, page) => {
        await showView(page, 'Files')
        await item(page, 'app main').click()
        await expect(item(page, 'app main')).toBeFocused()

        // Esc closes it and the file tree has the keys again.
        await goToFile(page)
        await expect(searchBox(page)).toBeFocused()
        await page.keyboard.press('Escape')
        await expect(popup(page)).toBeHidden()
        await expect(item(page, 'app main')).toBeFocused()

        await goToFile(page)
        await searchBox(page).fill('Pipeline/RunMessProc')
        // The file first; neither the git-ignored build nor the dependency is listed.
        await expect(results(page)).toHaveText([
          /^RunMessageProcessor\.phpsrc\/AgentCore\/Application\/Pipeline$/,
          /^RunMessageProcessorTest\.phptests\/Unit\/Pipeline$/
        ])
        await expect(popup(page).getByRole('option', { selected: true })).toHaveText(
          /^RunMessageProcessor\.php/
        )
        await saveScreenshot(page, 'search-everywhere')
        await page.keyboard.press('Enter')
        await expect(popup(page)).toBeHidden()
        await expect(tab(page, 'RunMessageProcessor.php')).toHaveAttribute('aria-selected', 'true')
        await expect(editor(page)).toHaveClass(/\bfocused\b/)

        // From the editor, too; a shorter fragment still puts the file first.
        await goToFile(page)
        await expect(searchBox(page)).toHaveValue('Pipeline/RunMessProc')
        await searchBox(page).fill('RunMessProc')
        await expect(results(page).first()).toHaveText(/^RunMessageProcessor\.php/)
        await page.keyboard.press('Escape')
        await expect(editor(page)).toHaveClass(/\bfocused\b/)
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
    await cleanProject()
  }
})

test('Go to File opens the popup on Files, and Tab moves between the kinds', async () => {
  const [app, cleanProject] = await makeProject()
  const [userData, cleanUserData] = await seedWorkspace([{ path: app, kind: 'project' }])
  try {
    await withApp(
      async (_app, page) => {
        await expect(page.getByRole('complementary', { name: 'Agents panel' })).toBeVisible()
        await goToFile(page)
        const selectedTab = popup(page).getByRole('tab', { selected: true })
        await expect(selectedTab).toHaveText('Files')
        await searchBox(page).fill('mproc')
        await expect(results(page).first()).toHaveText(/^MessageProcessor\.php/)
        await page.keyboard.press('Tab')
        await expect(selectedTab).toHaveText('Symbols')
        await expect(searchBox(page)).toBeFocused()
        await page.keyboard.press('Shift+Tab')
        await page.keyboard.press('Shift+Tab')
        await expect(selectedTab).toHaveText('Classes')
        // Go to Symbol's key switches the open popup, as does Go to Class's (Ctrl+N, which the
        // list would otherwise take to move down).
        await page.keyboard.press(mac ? 'Meta+Alt+KeyO' : 'Control+Alt+Shift+KeyN')
        await expect(selectedTab).toHaveText('Symbols')
        await page.keyboard.press(mac ? 'Meta+KeyO' : 'Control+KeyN')
        await expect(selectedTab).toHaveText('Classes')
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
    await cleanProject()
  }
})
