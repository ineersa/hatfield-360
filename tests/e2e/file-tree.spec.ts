import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import {
  appendFile,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import { join } from 'node:path'
import type { DirectoryListing } from '../../src/shared/file-tree-api'
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

/** A folder for test projects, resolved as git prints it. */
async function makeProjectsDir(): Promise<[string, () => Promise<void>]> {
  const [dir, cleanup] = await makeTempDir('projects')
  return [await realpath(dir), cleanup]
}

function makeRepo(parent: string, name: string): string {
  const repo = join(parent, name)
  git(parent, 'init', '-q', '-b', 'main', repo)
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'first')
  return repo
}

/** A user data folder whose workspace holds `folders`. */
async function seedWorkspace(
  folders: { path: string; kind: 'project' | 'folder' }[]
): Promise<[string, () => Promise<void>]> {
  const [userData, cleanup] = await makeTempDir('user-data')
  await mkdir(join(userData, 'workspaces'))
  await writeFile(
    join(userData, 'workspaces', 'default.hatfield-workspace'),
    JSON.stringify({ version: 1, folders })
  )
  return [userData, cleanup]
}

/** The OS folder picker can't be driven by Playwright (user-authorized for #8): answer it from the test. */
async function answerFolderPicker(app: ElectronApplication, folder: string): Promise<void> {
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] })
  }, folder)
}

const projectRows = (page: Page) =>
  page.getByRole('list', { name: 'Workspace folders' }).getByRole('listitem')
const tree = (page: Page) => page.getByRole('tree', { name: 'Files' })
const item = (page: Page, name: string) => tree(page).getByRole('treeitem', { name, exact: true })
const showView = (page: Page, name: 'Agents' | 'Files') =>
  page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name, exact: true }).click()

async function contextMenu(page: Page, row: ReturnType<typeof item>, action: string) {
  await row.click({ button: 'right' })
  await page.getByRole('menuitem', { name: action }).click()
}

test('folders added to the workspace become projects or plain folders, and can be moved between them', async () => {
  const [projects, cleanProjects] = await makeProjectsDir()
  const app = makeRepo(projects, 'app')
  git(app, 'worktree', 'add', '-q', '-b', 'feature', join(projects, 'app-feature'))
  const notes = join(projects, 'notes')
  await mkdir(notes)
  const [userData, cleanUserData] = await makeTempDir('user-data')
  const expectSavedKinds = async (kinds: string[]) => {
    const document: unknown = JSON.parse(
      await readFile(join(userData, 'workspaces', 'default.hatfield-workspace'), 'utf8')
    )
    expect(document).toMatchObject({ folders: kinds.map((kind) => ({ kind })) })
  }
  try {
    await withApp(
      async (electronApp, page) => {
        for (const folder of [app, notes]) {
          await answerFolderPicker(electronApp, folder)
          await page.getByRole('button', { name: 'Add Folder to Workspace' }).first().click()
        }
        // Only the repository is a project; the plain folder shows only in the file tree.
        await expect(projectRows(page)).toHaveText(['appmain', 'featureapp-feature'])
        await expectSavedKinds(['project', 'folder'])

        await showView(page, 'Files')
        await expect(tree(page).getByRole('treeitem')).toHaveText([
          'appmain',
          'appfeature',
          'notes'
        ])
        await expect(item(page, 'app feature worktree')).toBeVisible()

        // A folder that becomes a repository later stays a plain folder.
        git(notes, 'init', '-q', '-b', 'trunk')
        await contextMenu(page, item(page, 'notes'), 'Show in Projects')
        await showView(page, 'Agents')
        await expect(projectRows(page)).toHaveText(['appmain', 'featureapp-feature', 'notestrunk'])

        await contextMenu(page, projectRows(page).first(), 'Hide from Projects')
        await expect(projectRows(page)).toHaveText(['notestrunk'])
        await expectSavedKinds(['folder', 'project'])
      },
      { userDataDir: userData }
    )

    await withApp(
      async (electronApp, page) => {
        // The kinds were saved: app stays out of Projects, and with it its worktree.
        await expect(projectRows(page)).toHaveText(['notestrunk'])
        await showView(page, 'Files')
        await expect(tree(page).getByRole('treeitem')).toHaveText(['app', 'notestrunk'])

        // Adding a plain folder again brings it back into Projects.
        await answerFolderPicker(electronApp, app)
        await page.getByRole('button', { name: 'Add Folder to Workspace' }).click()
        await expect(tree(page).getByRole('treeitem')).toHaveText([
          'appmain',
          'appfeature',
          'notestrunk'
        ])
        await showView(page, 'Agents')
        await expect(projectRows(page)).toHaveText(['appmain', 'featureapp-feature', 'notestrunk'])
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
    await cleanProjects()
  }
})

test('the file tree follows the disk and git ignore rules in expanded folders', async () => {
  const [projects, cleanProjects] = await makeProjectsDir()
  const repo = makeRepo(projects, 'app')
  await writeFile(join(repo, '.gitignore'), 'dist/\n')
  git(repo, 'add', '.gitignore')
  git(repo, 'commit', '-q', '-m', 'ignore dist')
  await mkdir(join(repo, 'src'))
  await mkdir(join(repo, 'dist'))
  await writeFile(join(repo, 'src', 'a.ts'), '')
  await writeFile(join(repo, 'dist', 'out.js'), '')
  await writeFile(join(repo, 'notes.txt'), '')
  await writeFile(join(repo, 'README.md'), '')
  const plain = join(projects, 'logs')
  await mkdir(join(plain, 'dist'), { recursive: true })
  await writeFile(join(plain, '.gitignore'), 'dist/\n')
  const [userData, cleanUserData] = await seedWorkspace([
    { path: repo, kind: 'project' },
    { path: plain, kind: 'folder' }
  ])
  const ignored = (name: string) => expect(item(page, name)).toHaveAttribute('data-ignored', 'true')
  const notIgnored = (name: string) => expect(item(page, name)).not.toHaveAttribute('data-ignored')
  let page: Page
  try {
    await withApp(
      async (_app, shown) => {
        page = shown
        await showView(page, 'Files')
        await item(page, 'app').click()
        await item(page, 'src').click()
        await expect(tree(page).getByRole('treeitem')).toHaveText([
          'appmain',
          '.git',
          'dist',
          'src',
          'a.ts',
          '.gitignore',
          'notes.txt',
          'README.md',
          'logs'
        ])
        await ignored('dist')
        await ignored('.git')
        await notIgnored('src')
        await notIgnored('README.md')

        // Changes on disk show up in expanded folders.
        await writeFile(join(repo, 'src', 'b.ts'), '')
        await expect(item(page, 'b.ts')).toBeVisible()
        await rename(join(repo, 'src', 'b.ts'), join(repo, 'src', 'c.ts'))
        await expect(item(page, 'c.ts')).toBeVisible()
        await expect(item(page, 'b.ts')).toHaveCount(0)
        await rm(join(repo, 'src', 'c.ts'))
        await expect(item(page, 'c.ts')).toHaveCount(0)
        await mkdir(join(repo, 'src', 'lib'))
        await expect(item(page, 'lib')).toBeVisible()

        // Editing `.gitignore` updates the dimming by itself, also in expanded subfolders.
        await appendFile(join(repo, '.gitignore'), 'README.md\nsrc/a.ts\n')
        await ignored('README.md')
        await ignored('a.ts')
        await writeFile(join(repo, '.gitignore'), 'dist/\n')
        await notIgnored('README.md')
        await notIgnored('a.ts')

        // `.git/info/exclude` isn't watched; Reload from Disk reads it.
        await mkdir(join(repo, '.git', 'info'), { recursive: true })
        await appendFile(join(repo, '.git', 'info', 'exclude'), 'notes.txt\n')
        await contextMenu(page, item(page, 'app'), 'Reload from Disk')
        await ignored('notes.txt')

        // A plain folder has nothing dimmed, even with ignore rules of its own.
        await item(page, 'logs').click()
        await expect(item(page, '.gitignore').last()).toBeVisible()
        await expect(tree(page).getByRole('treeitem').last()).toHaveText('.gitignore')
        await expect(tree(page).locator('[data-ignored]')).toHaveCount(3)
        await saveScreenshot(page, 'file-tree')

        await page.getByRole('button', { name: 'Hide Ignored Files' }).click()
        await expect(tree(page).getByRole('treeitem')).toHaveText([
          'appmain',
          'src',
          'lib',
          'a.ts',
          '.gitignore',
          'README.md',
          'logs',
          'dist',
          '.gitignore'
        ])
        await page.getByRole('button', { name: 'Hide Ignored Files' }).click()
        await expect(item(page, 'notes.txt')).toBeVisible()

        // Collapsing and expanding again lists the folder fresh.
        await item(page, 'src').click()
        await expect(item(page, 'a.ts')).toHaveCount(0)
        await writeFile(join(repo, 'src', 'later.ts'), '')
        await item(page, 'src').click()
        await expect(item(page, 'later.ts')).toBeVisible()
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
    await cleanProjects()
  }
})

test('the renderer can list only inside the workspace folders', async () => {
  const [projects, cleanProjects] = await makeProjectsDir()
  const root = join(projects, 'root')
  const outside = join(projects, 'outside')
  await mkdir(join(root, 'inner'), { recursive: true })
  await mkdir(outside)
  await writeFile(join(outside, 'secret'), '')
  // Symlinks need extra rights on Windows.
  const symlinks = process.platform !== 'win32'
  if (symlinks) await symlink(outside, join(root, 'escape'))
  const [userData, cleanUserData] = await seedWorkspace([{ path: root, kind: 'folder' }])
  try {
    await withApp(
      async (_app, page) => {
        const list = (path: string) =>
          page.evaluate<DirectoryListing>(`window.desktop.listDirectory(${JSON.stringify(path)})`)
        await expect.poll(async () => (await list(root)).status).toBe('ok')
        expect(await list(join(root, 'inner'))).toEqual({
          path: join(root, 'inner'),
          status: 'ok',
          entries: []
        })
        for (const path of [
          outside,
          join(root, '..', 'outside'),
          'root',
          ...(symlinks ? [join(root, 'escape')] : [])
        ]) {
          expect(await list(path)).toEqual({
            path,
            status: 'error',
            message: 'Not inside the workspace'
          })
        }

        // A folder removed from the workspace stops being readable.
        await showView(page, 'Files')
        await contextMenu(page, item(page, 'root'), 'Remove from Workspace')
        await expect(tree(page)).toHaveCount(0)
        expect(await list(root)).toMatchObject({ status: 'error' })
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
    await cleanProjects()
  }
})
