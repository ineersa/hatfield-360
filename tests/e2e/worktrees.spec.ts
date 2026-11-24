import { expect, test, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { git, makeRepo } from './git-repository'
import { makeTempDir, saveScreenshot, withApp } from './launch-app'

/** A user data folder whose workspace holds `folders`, with the DOM renderer so terminal text is readable. */
async function seedWorkspace(folders: string[]): Promise<[string, () => Promise<void>]> {
  const [userData, cleanup] = await makeTempDir('user-data')
  await mkdir(join(userData, 'workspaces'))
  await writeFile(
    join(userData, 'workspaces', 'default.hatfield-workspace'),
    JSON.stringify({ version: 1, folders: folders.map((path) => ({ path })) })
  )
  await writeFile(join(userData, 'settings.json'), '{ "terminal.gpuAcceleration": false }')
  return [userData, cleanup]
}

const rows = (page: Page) =>
  page.getByRole('list', { name: 'Workspace folders' }).locator(':scope > li[aria-label]')
const checkoutRows = (page: Page) =>
  page.getByRole('list', { name: 'app worktrees' }).getByRole('listitem')

test('projects list their git worktrees and follow git as worktrees come and go', async () => {
  const { projects, repo, cleanup } = await makeRepo()
  const feature = join(projects, 'app-feature')
  git(repo, 'worktree', 'add', '-q', '-b', 'feature', feature)
  const notes = join(projects, 'notes')
  await mkdir(notes)
  const [userData, cleanUserData] = await seedWorkspace([repo, notes])
  try {
    await withApp(
      async (_app, page) => {
        // The project shows its own branch; its linked worktree gets a row; the plain folder has none.
        await expect(rows(page)).toHaveText(['appmain', 'notes'])
        await expect(checkoutRows(page)).toHaveCount(0)
        await page.getByRole('button', { name: 'Worktrees (1)', exact: true }).click()
        await expect(checkoutRows(page)).toHaveText(['feature'])

        git(repo, 'worktree', 'add', '-q', '-b', 'second', join(projects, 'app-second'))
        await expect(page.getByRole('listitem', { name: 'second worktree' })).toBeVisible()
        // A row's path shows just under the mouse pointer.
        const row = page.getByRole('listitem', { name: 'feature worktree' })
        const box = await row.boundingBox()
        if (!box) throw new Error('feature row not on screen')
        const pointer = { x: box.x + 40, y: box.y + box.height / 2 }
        await page.mouse.move(pointer.x, pointer.y)
        await expect(page.getByRole('tooltip')).toHaveText(feature)
        const tip = await page.locator('[data-slot="tooltip-content"]').boundingBox()
        if (!tip) throw new Error('tooltip not on screen')
        expect(Math.abs(tip.x - pointer.x)).toBeLessThan(2)
        expect(tip.y - pointer.y).toBeGreaterThan(0)
        expect(tip.y - pointer.y).toBeLessThan(30)
        await saveScreenshot(page, 'worktrees-listed')
        await page.mouse.move(0, 0)
        git(repo, 'worktree', 'remove', join(projects, 'app-second'))
        await expect(page.getByRole('listitem', { name: 'second worktree' })).toHaveCount(0)

        // Switching branch inside a linked worktree renames its row.
        git(feature, 'switch', '-q', '-c', 'renamed')
        await expect(page.getByRole('listitem', { name: 'renamed worktree' })).toBeVisible()
        await expect(page.getByRole('listitem', { name: 'feature worktree' })).toHaveCount(0)

        await page.getByRole('listitem', { name: 'renamed worktree' }).click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Open Terminal Here' }).click()
        const pane = page.getByTestId('terminal-pane')
        // The terminal has the keys once its shell is up, without a click.
        await expect(pane).toHaveAttribute('data-pid', /^\d+$/)
        await page.keyboard.type('pwd')
        await page.keyboard.press('Enter')
        await expect(pane.locator('.xterm-rows')).toContainText(feature)

        git(notes, 'init', '-q', '-b', 'trunk')
        // A plain folder that becomes a repository shows its branch.
        await expect(rows(page)).toHaveText(['appmain', 'notestrunk'])
        await expect(checkoutRows(page)).toHaveText(['renamed'])

        // Clicking a project folds its worktrees away and back.
        await page.getByRole('listitem', { name: 'app', exact: true }).click()
        await expect(rows(page)).toHaveText(['appmain', 'notestrunk'])
        await expect(checkoutRows(page)).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Expand app' })).toBeVisible()
        await page.getByRole('listitem', { name: 'app', exact: true }).click()
        await expect(rows(page)).toHaveText(['appmain', 'notestrunk'])
        await page.getByRole('button', { name: 'Worktrees (1)', exact: true }).click()
        await expect(checkoutRows(page)).toHaveText(['renamed'])

        // A repository git can't read shows why instead of passing for a plain folder.
        await writeFile(join(notes, '.git', 'HEAD'), 'not a ref\n')
        await expect(page.getByRole('alert')).toContainText('Git: not a git repository')
        await saveScreenshot(page, 'worktrees-broken')
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
    await cleanup()
  }
})
