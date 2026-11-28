import { expect, test, type Page } from '@playwright/test'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { changes, git, gitOutput, row, showGit } from './git-repository'
import { makeTempDir, saveScreenshot, withApp } from './launch-app'

/** A repository `name` inside `parent`, with one file committed on `main`. */
async function repository(parent: string, name: string, file: string): Promise<string> {
  const repo = join(parent, name)
  git(parent, 'init', '-q', '-b', 'main', repo)
  await writeFile(join(repo, file), `${file} one\n`)
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', `Add ${file}`)
  return repo
}

/**
 * `apps`, a folder that isn't a repository, holding the repositories `api` (with a linked worktree
 * outside `apps` and an ignored `dist`) and `web` (with an uncommitted change), a plain `docs`
 * folder and the shared CLAUDE.md; a workspace with `apps` as a project, not yet marked.
 */
async function multiRepoFixture() {
  const [dir, cleanup] = await makeTempDir('multi-repo')
  const root = await realpath(dir)
  const apps = join(root, 'apps')
  await mkdir(join(apps, 'docs'), { recursive: true })
  await writeFile(join(apps, 'CLAUDE.md'), '# Shared instructions\n')
  const api = await repository(apps, 'api', '.gitignore')
  await writeFile(join(api, '.gitignore'), 'dist/\n')
  git(api, 'commit', '-q', '-am', 'Ignore dist')
  await mkdir(join(api, 'dist'))
  await writeFile(join(api, 'dist', 'bundle.js'), 'built\n')
  git(api, 'worktree', 'add', '-q', '-b', 'feature', join(root, 'api-feature'))
  const web = await repository(apps, 'web', 'w.txt')
  await writeFile(join(web, 'w.txt'), 'w.txt two\n')
  const userData = join(root, 'user-data')
  await mkdir(join(userData, 'workspaces'), { recursive: true })
  const workspace = join(userData, 'workspaces', 'default.hatfield-workspace')
  await writeFile(
    workspace,
    JSON.stringify({ version: 1, folders: [{ path: apps, kind: 'project' }] })
  )
  // Main passes its environment to git: commits stay off the user's config and keys.
  const gitConfig = join(root, 'gitconfig')
  await writeFile(
    gitConfig,
    '[user]\n\tname = Tester\n\temail = tester@example.com\n[commit]\n\tgpgsign = false\n'
  )
  return {
    apps,
    api,
    web,
    workspace,
    userData,
    env: { GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1' },
    cleanup
  }
}

const showView = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name, exact: true }).click()
const projectRow = (page: Page) =>
  page.getByRole('list', { name: 'Workspace folders' }).getByRole('listitem', { name: 'apps' })
const files = (page: Page) => page.getByRole('tree', { name: 'Files' })
const fileItem = (page: Page, name: string) =>
  files(page).getByRole('treeitem', { name, exact: true })
async function savedFolders(workspace: string): Promise<unknown> {
  const saved: unknown = JSON.parse(await readFile(workspace, 'utf8'))
  return typeof saved === 'object' && saved !== null && 'folders' in saved ? saved.folders : null
}
const notGit = (page: Page) => changes(page).getByText('Not a git repository')

test('a folder marked as multi-repo gives each repository inside it the Git panel, worktrees and ignore status', async () => {
  const fixture = await multiRepoFixture()
  try {
    await withApp(
      async (_app, page) => {
        // Unmarked, the folder is one project git can't read.
        await showGit(page)
        await expect(notGit(page)).toBeVisible()

        await showView(page, 'Agents')
        await projectRow(page).click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Mark as Multi-Repo Folder' }).click()

        // Each repository, and api's linked worktree, is a group of its own; the note is gone.
        await showGit(page)
        await expect(row(page, 'apps/api')).toBeVisible()
        // Main saves the mark before it publishes the change.
        expect(await savedFolders(fixture.workspace)).toEqual([
          { path: fixture.apps, kind: 'project', multiRepo: true }
        ])
        await expect(row(page, 'api-feature')).toBeVisible()
        await expect(row(page, 'apps/web')).toBeVisible()
        await expect(notGit(page)).toHaveCount(0)
        await expect(row(page, 'apps/web')).toHaveAccessibleDescription('branch main')
        await saveScreenshot(page, 'multi-repo-git-panel')

        // Committing in web leaves api alone.
        await changes(page).getByRole('checkbox', { name: 'Include w.txt', exact: true }).click()
        await page.getByRole('textbox', { name: 'Commit message' }).fill('Change w')
        await page.getByRole('button', { name: 'Commit', exact: true }).click()
        await expect(row(page, 'w.txt')).toHaveCount(0)
        expect(gitOutput(fixture.web, 'log', '-1', '--format=%s')).toBe('Change w')
        expect(gitOutput(fixture.api, 'log', '-1', '--format=%s')).toBe('Ignore dist')

        // The repository's linked worktree is listed under the project, named with its repository.
        await showView(page, 'Agents')
        await page.getByRole('button', { name: 'Worktrees (1)', exact: true }).click()
        await expect(
          page.getByRole('list', { name: 'apps worktrees' }).getByRole('listitem')
        ).toHaveText(['api: feature'])
        await saveScreenshot(page, 'multi-repo-agents-panel')

        // Files inside a repository are dimmed by that repository's ignore rules.
        await showView(page, 'Files')
        await fileItem(page, 'apps').click()
        await fileItem(page, 'api').click()
        await expect(fileItem(page, 'dist')).toHaveAttribute('data-ignored', 'true')
        await expect(fileItem(page, '.gitignore')).not.toHaveAttribute('data-ignored')

        // The next launch reopens this last view, Files, so Git can be opened there.
      },
      { userDataDir: fixture.userData, env: fixture.env }
    )

    // A repository cloned into the folder while the app is closed is listed at the next launch.
    await repository(fixture.apps, 'cli', 'c.txt')
    await withApp(
      async (_app, page) => {
        // The mark is kept; Unmark from the Files tree turns the folder back into one project.
        await showGit(page)
        await expect(row(page, 'apps/api')).toBeVisible()
        await expect(row(page, 'apps/cli')).toBeVisible()
        await showView(page, 'Files')
        await fileItem(page, 'apps').click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Unmark as Multi-Repo Folder' }).click()
        await showGit(page)
        await expect(notGit(page)).toBeVisible()
        await expect(row(page, 'apps/api')).toHaveCount(0)
        expect(await savedFolders(fixture.workspace)).toEqual([
          { path: fixture.apps, kind: 'project' }
        ])
      },
      { userDataDir: fixture.userData, env: fixture.env }
    )
  } finally {
    await fixture.cleanup()
  }
})
