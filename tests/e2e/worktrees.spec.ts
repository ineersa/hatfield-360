import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { makeTempDir, saveScreenshot, withApp } from './launch-app'

function git(cwd: string, ...args: string[]): void {
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      '-c',
      'commit.gpgsign=false',
      ...args
    ],
    { cwd, stdio: 'ignore' }
  )
}

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

/** A repository `app` with one commit on `main`, in a fresh folder (resolved, as git prints it). */
async function makeRepo(): Promise<{
  projects: string
  repo: string
  cleanup: () => Promise<void>
}> {
  const [dir, cleanup] = await makeTempDir('projects')
  const projects = await realpath(dir)
  const repo = join(projects, 'app')
  git(projects, 'init', '-q', '-b', 'main', repo)
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'first')
  return { projects, repo, cleanup }
}

const rows = (page: Page) =>
  page.getByRole('list', { name: 'Workspace folders' }).getByRole('listitem')

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
        await expect(rows(page)).toHaveText(['appmain', 'featureapp-feature', 'notes'])

        git(repo, 'worktree', 'add', '-q', '-b', 'second', join(projects, 'app-second'))
        await expect(page.getByRole('listitem', { name: 'second worktree' })).toBeVisible()
        await saveScreenshot(page, 'worktrees-listed')
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
        await expect(rows(page)).toHaveText(['appmain', 'renamedapp-feature', 'notestrunk'])

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
