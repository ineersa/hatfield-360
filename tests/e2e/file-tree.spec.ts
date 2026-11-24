import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import {
  appendFile,
  chmod,
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
import { lines, openFile, tab } from './editor-page'
import { makeTempDir, requireFolderPermissions, saveScreenshot, withApp } from './launch-app'
import { CLIPBOARD_TAG, keepUserClipboard } from './user-clipboard'
import { seedWorkspace } from './workspace-seed'

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

/** The OS folder picker can't be driven by Playwright (user-authorized for #8): answer it from the test. */
async function answerFolderPicker(app: ElectronApplication, folder: string): Promise<void> {
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] })
  }, folder)
}

const projectRows = (page: Page) =>
  page.getByRole('list', { name: 'Workspace folders' }).locator(':scope > li[aria-label]')
const checkoutRows = (page: Page) =>
  page.getByRole('list', { name: 'app worktrees' }).getByRole('listitem')
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
  // Polled: the workspace file is written after the panels update.
  const expectSavedKinds = (kinds: string[]) =>
    expect
      .poll(async (): Promise<unknown> =>
        JSON.parse(
          await readFile(join(userData, 'workspaces', 'default.hatfield-workspace'), 'utf8')
        )
      )
      .toMatchObject({ folders: kinds.map((kind) => ({ kind })) })
  try {
    await withApp(
      async (electronApp, page) => {
        for (const folder of [app, notes]) {
          await answerFolderPicker(electronApp, folder)
          await page.getByRole('button', { name: 'Add Folder to Workspace' }).first().click()
        }
        // Only the repository is a project; the plain folder shows only in the file tree.
        await expect(projectRows(page)).toHaveText(['appmain'])
        await expect(checkoutRows(page)).toHaveCount(0)
        await page.getByRole('button', { name: 'Worktrees (1)', exact: true }).click()
        await expect(checkoutRows(page)).toHaveText(['feature'])
        await expectSavedKinds(['project', 'folder'])

        // The worktree sits under its project, as in Projects.
        await showView(page, 'Files')
        await expect(tree(page).getByRole('treeitem')).toHaveText(['appmain', 'notes'])
        await item(page, 'app main').click()
        await expect(tree(page).getByRole('treeitem')).toHaveText([
          'appmain',
          'featureapp-feature',
          'notes'
        ])
        await expect(item(page, 'feature worktree app-feature')).toHaveAttribute('aria-level', '2')

        // A folder that becomes a repository later stays a plain folder.
        git(notes, 'init', '-q', '-b', 'trunk')
        await contextMenu(page, item(page, 'notes'), 'Show in Projects')
        await showView(page, 'Agents')
        await expect(projectRows(page)).toHaveText(['appmain', 'notestrunk'])
        await expect(checkoutRows(page)).toHaveCount(0)
        await page.getByRole('button', { name: 'Worktrees (1)', exact: true }).click()
        await expect(checkoutRows(page)).toHaveText(['feature'])

        await contextMenu(page, projectRows(page).first(), 'Hide from Projects')
        await expect(projectRows(page)).toHaveText(['notestrunk'])
        await expect(checkoutRows(page)).toHaveCount(0)
        await expectSavedKinds(['folder', 'project'])
      },
      { userDataDir: userData }
    )

    await withApp(
      async (electronApp, page) => {
        // The kinds were saved: app stays out of Projects, and with it its worktree.
        await expect(projectRows(page)).toHaveText(['notestrunk'])
        await expect(checkoutRows(page)).toHaveCount(0)
        await showView(page, 'Files')
        // app was left expanded, and reopens so.
        await expect(item(page, 'app')).toHaveAttribute('aria-expanded', 'true')
        await item(page, 'app').click()
        await expect(tree(page).getByRole('treeitem')).toHaveText(['app', 'notestrunk'])

        // Adding a plain folder again brings it back into Projects.
        await answerFolderPicker(electronApp, app)
        await page.getByRole('button', { name: 'Add Folder to Workspace' }).click()
        await expect(tree(page).getByRole('treeitem')).toHaveText(['appmain', 'notestrunk'])
        await showView(page, 'Agents')
        await expect(projectRows(page)).toHaveText(['appmain', 'notestrunk'])
        await expect(checkoutRows(page)).toHaveCount(0)
        await page.getByRole('button', { name: 'Worktrees (1)', exact: true }).click()
        await expect(checkoutRows(page)).toHaveText(['feature'])
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
    await cleanProjects()
  }
})

test('a project and its linked worktree can both be roots', async () => {
  const [projects, cleanProjects] = await makeProjectsDir()
  const app = makeRepo(projects, 'app')
  const feature = join(projects, 'app-feature')
  git(app, 'worktree', 'add', '-q', '-b', 'feature', feature)
  await writeFile(join(feature, 'feature.txt'), '')
  const [userData, cleanUserData] = await seedWorkspace([
    { path: app, kind: 'project' },
    { path: feature, kind: 'project' }
  ])
  try {
    await withApp(
      async (_app, page) => {
        await showView(page, 'Files')
        await item(page, 'app main').click()
        // Each lists the other as a worktree; opening one under the other must not loop.
        // The worktree's folder is open both under the project and as its own root.
        await item(page, 'feature worktree app-feature').click()
        await expect(item(page, 'feature.txt')).toHaveCount(2)
        await expect(tree(page).getByRole('treeitem', { name: 'Loading…' })).toHaveCount(0)
        await item(page, 'app main').click()
        await item(page, 'app main').click()
        await expect(item(page, 'feature.txt')).toHaveCount(2)
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
  // A repository kept as a plain folder, until it is shown in Projects.
  git(plain, 'init', '-q', '-b', 'main')
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
        await item(page, 'app main').click()
        await item(page, 'src').click()
        // `.git` is never listed: it is git's, not the project's.
        await expect(tree(page).getByRole('treeitem')).toHaveText([
          'appmain',
          'dist',
          'src',
          'a.ts',
          '.gitignore',
          'notes.txt',
          'README.md',
          'logs'
        ])
        await ignored('dist')
        await notIgnored('src')
        await notIgnored('README.md')
        // Catppuccin icons follow the file and folder names, and whether a folder is open.
        const icon = (name: string) => item(page, name).locator('svg[data-icon]')
        await expect(icon('app main')).toHaveAttribute('data-icon', '_root_open')
        await expect(icon('src')).toHaveAttribute('data-icon', 'folder_src_open')
        await expect(icon('dist')).toHaveAttribute('data-icon', 'folder_dist')
        await expect(icon('a.ts')).toHaveAttribute('data-icon', 'typescript')
        await expect(icon('README.md')).toHaveAttribute('data-icon', 'readme')
        await expect(icon('notes.txt')).toHaveAttribute('data-icon', 'text')
        // Lucide has one icon per category of file and folder.
        await writeFile(join(userData, 'settings.json'), '{ "workbench.iconTheme": "lucide" }')
        await expect(icon('src')).toHaveAttribute('data-icon', 'folder-code')
        await expect(icon('dist')).toHaveAttribute('data-icon', 'folder-build')
        await expect(icon('a.ts')).toHaveAttribute('data-icon', 'file-code')
        await expect(icon('README.md')).toHaveAttribute('data-icon', 'file-text')
        await expect(icon('.gitignore')).toHaveAttribute('data-icon', 'file-config')
        await saveScreenshot(page, 'file-tree-lucide')
        await rm(join(userData, 'settings.json'))
        await expect(icon('a.ts')).toHaveAttribute('data-icon', 'typescript')

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
        await contextMenu(page, item(page, 'app main'), 'Reload from Disk')
        await ignored('notes.txt')

        // A plain folder has nothing dimmed, even with ignore rules of its own.
        await item(page, 'logs').click()
        await expect(item(page, '.gitignore').last()).toBeVisible()
        await expect(tree(page).getByRole('treeitem').last()).toHaveText('.gitignore')
        await expect(tree(page).locator('[data-ignored]')).toHaveCount(2)
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

        // Reopening a folder also lists the open folders kept under it fresh.
        await item(page, 'app main').click()
        await expect(item(page, 'src')).toHaveCount(0)
        await writeFile(join(repo, 'src', 'kept.ts'), '')
        await item(page, 'app main').click()
        await expect(item(page, 'kept.ts')).toBeVisible()

        // Shown in Projects, the folder dims what its repository ignores.
        await contextMenu(page, item(page, 'logs'), 'Show in Projects')
        await expect(item(page, 'dist').last()).toHaveAttribute('data-ignored', 'true')
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
    await cleanProjects()
  }
})

const clipboardText = (app: ElectronApplication) =>
  app.evaluate(({ clipboard }) => clipboard.readText())

test(
  'the file tree is driven from the keyboard and copies paths',
  { tag: CLIPBOARD_TAG },
  async () => {
    const [projects, cleanProjects] = await makeProjectsDir()
    const repo = makeRepo(projects, 'app')
    await mkdir(join(repo, 'docs'))
    await mkdir(join(repo, 'src'))
    await writeFile(join(repo, 'src', 'a.ts'), '')
    await writeFile(join(repo, 'package.json'), '{}')
    await writeFile(join(repo, 'README.md'), '')
    const [userData, cleanUserData] = await seedWorkspace([{ path: repo, kind: 'project' }])
    try {
      await withApp(
        async (electronApp, page) => {
          const restoreClipboard = await keepUserClipboard(electronApp)
          try {
            await showView(page, 'Files')
            const root = item(page, 'app main')
            await root.click()
            await expect(root).toBeFocused()
            await expect(tree(page).getByRole('treeitem')).toHaveText([
              'appmain',
              'docs',
              'src',
              'package.json',
              'README.md'
            ])
            await expect(item(page, 'src')).toHaveAttribute('aria-posinset', '2')
            await expect(item(page, 'src')).toHaveAttribute('aria-setsize', '4')

            // Right goes into an open folder and opens a closed one; Left closes it, then goes up.
            await page.keyboard.press('ArrowRight')
            await expect(item(page, 'docs')).toBeFocused()
            await page.keyboard.press('ArrowRight')
            await expect(item(page, 'Empty')).toBeVisible()
            await page.keyboard.press('ArrowLeft')
            await expect(item(page, 'Empty')).toHaveCount(0)
            await page.keyboard.press('ArrowLeft')
            await expect(root).toBeFocused()

            await page.keyboard.press('End')
            await expect(item(page, 'README.md')).toBeFocused()
            await page.keyboard.press('Home')
            await expect(root).toBeFocused()
            await page.keyboard.type('pa')
            await expect(item(page, 'package.json')).toBeFocused()
            await expect(item(page, 'package.json')).toHaveAttribute('aria-selected', 'true')

            await page.keyboard.press('ControlOrMeta+Shift+KeyC')
            await expect.poll(() => clipboardText(electronApp)).toBe(join(repo, 'package.json'))

            // `*` opens the folder's siblings too.
            await page.keyboard.press('ArrowUp')
            await page.keyboard.press('*')
            await expect(item(page, 'a.ts')).toBeVisible()
            await item(page, 'a.ts').click()
            await page.keyboard.press('ControlOrMeta+Alt+Shift+KeyC')
            await expect.poll(() => clipboardText(electronApp)).toBe(join('src', 'a.ts'))
            await contextMenu(page, root, 'Copy Path')
            await expect.poll(() => clipboardText(electronApp)).toBe(repo)
            await contextMenu(page, item(page, 'src'), 'Copy Relative Path')
            await expect.poll(() => clipboardText(electronApp)).toBe('src')
            await saveScreenshot(page, 'file-tree-keyboard')

            await page.getByRole('button', { name: 'Collapse All' }).click()
            await expect(tree(page).getByRole('treeitem')).toHaveText(['appmain'])
          } finally {
            await restoreClipboard()
          }
        },
        { userDataDir: userData }
      )
    } finally {
      await cleanUserData()
      await cleanProjects()
    }
  }
)

test("a folder that can't be listed says why and can be retried", async () => {
  requireFolderPermissions()
  const [projects, cleanProjects] = await makeProjectsDir()
  const root = join(projects, 'notes')
  const locked = join(root, 'locked')
  await mkdir(locked, { recursive: true })
  await chmod(locked, 0o000)
  const [userData, cleanUserData] = await seedWorkspace([{ path: root, kind: 'folder' }])
  try {
    await withApp(
      async (_app, page) => {
        await showView(page, 'Files')
        await item(page, 'notes').click()
        await item(page, 'locked').click()
        const error = tree(page).getByRole('treeitem', { name: /^Couldn't list this folder: / })
        await expect(error).toBeVisible()
        await expect(error).toHaveAttribute('aria-level', '3')

        await chmod(locked, 0o755)
        await writeFile(join(locked, 'todo.md'), '')
        await tree(page).getByRole('button', { name: 'Retry' }).click()
        await expect(item(page, 'todo.md')).toBeVisible()
        await expect(error).toHaveCount(0)
      },
      { userDataDir: userData }
    )
  } finally {
    await chmod(locked, 0o755).catch(() => undefined)
    await cleanUserData()
    await cleanProjects()
  }
})

test('a long tree scrolls instead of squeezing its rows', async () => {
  const [projects, cleanProjects] = await makeProjectsDir()
  const root = join(projects, 'many')
  await mkdir(root)
  for (let index = 0; index < 80; index += 1) {
    await writeFile(join(root, `file-${index}.txt`), '')
  }
  const [userData, cleanUserData] = await seedWorkspace([{ path: root, kind: 'folder' }])
  try {
    await withApp(
      async (_app, page) => {
        await showView(page, 'Files')
        await item(page, 'many').click()
        await expect(item(page, 'file-79.txt')).toBeAttached()
        const rootBox = await item(page, 'many').boundingBox()
        const fileBox = await item(page, 'file-0.txt').boundingBox()
        expect(fileBox?.height).toBe(rootBox?.height)
        expect(
          await tree(page).evaluate(
            (element: { scrollHeight: number; clientHeight: number }) =>
              element.scrollHeight > element.clientHeight
          )
        ).toBe(true)
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

const select = (page: Page) => page.getByRole('button', { name: 'Select Opened File' })
/** The file's row is selected, focused and on screen. */
const revealed = async (page: Page, name: string) => {
  await expect(item(page, name)).toHaveAttribute('aria-selected', 'true')
  await expect(item(page, name)).toBeFocused()
  await expect(item(page, name)).toBeInViewport()
}

test('Select Opened File reveals the active tab in the tree, from the button or a bound key', async () => {
  const [projects, cleanProjects] = await makeProjectsDir()
  const app = makeRepo(projects, 'app')
  await writeFile(join(app, '.gitignore'), 'dist/\n')
  await mkdir(join(app, 'src', 'deep'), { recursive: true })
  await mkdir(join(app, 'dist'))
  await writeFile(join(app, 'src', 'deep', 'a.ts'), 'export const a = 1\n')
  await writeFile(join(app, 'dist', 'out.js'), '')
  // A linked worktree outside the project's folder, shown under the project.
  const feature = join(projects, 'app-feature')
  git(app, 'worktree', 'add', '-q', '-b', 'feature', feature)
  await mkdir(join(feature, 'lib'))
  await writeFile(join(feature, 'lib', 'b.ts'), '')
  const [userData, cleanUserData] = await seedWorkspace([{ path: app, kind: 'project' }])
  const key = process.platform === 'darwin' ? 'cmd+alt+shift+l' : 'ctrl+alt+shift+l'
  await writeFile(
    join(userData, 'keybindings.json'),
    JSON.stringify([{ key, command: 'hatfield.files.selectOpenedFile' }])
  )
  try {
    await withApp(
      async (_app, page) => {
        await showView(page, 'Files')
        await expect(select(page)).toBeDisabled()

        await openFile(page, 'app main', 'src', 'deep', 'a.ts')
        await expect(tab(page, 'a.ts')).toHaveAttribute('aria-selected', 'true')
        await page.getByRole('button', { name: 'Collapse All' }).click()
        await expect(item(page, 'src')).toHaveCount(0)
        await expect(select(page)).toBeEnabled()
        await select(page).click()
        await revealed(page, 'a.ts')
        await saveScreenshot(page, 'files-select-opened-file')

        // The bound key works from the editor too.
        await page.getByRole('button', { name: 'Collapse All' }).click()
        await lines(page).click()
        await page.keyboard.press(
          process.platform === 'darwin' ? 'Meta+Alt+Shift+KeyL' : 'Control+Alt+Shift+KeyL'
        )
        await revealed(page, 'a.ts')

        await expect(item(page, 'feature worktree app-feature')).toBeVisible()
        await openFile(page, 'feature worktree app-feature', 'lib', 'b.ts')
        await expect(tab(page, 'b.ts')).toHaveAttribute('aria-selected', 'true')
        await page.getByRole('button', { name: 'Collapse All' }).click()
        await expect(select(page)).toBeEnabled()
        await select(page).click()
        await revealed(page, 'b.ts')

        // A file Hide Ignored Files hides is shown again.
        await openFile(page, 'dist', 'out.js')
        await expect(tab(page, 'out.js')).toHaveAttribute('aria-selected', 'true')
        await page.getByRole('button', { name: 'Collapse All' }).click()
        await page.getByRole('button', { name: 'Hide Ignored Files' }).click()
        await expect(select(page)).toBeEnabled()
        await select(page).click()
        await revealed(page, 'out.js')
        await expect(page.getByRole('button', { name: 'Hide Ignored Files' })).toHaveAttribute(
          'aria-pressed',
          'false'
        )
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
    await cleanProjects()
  }
})
