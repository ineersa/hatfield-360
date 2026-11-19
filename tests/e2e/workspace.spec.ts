import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { clickMenuItem } from './app-menu'
import { makeTempDir, saveScreenshot, withApp } from './launch-app'

const workspaceFile = (userDataDir: string) =>
  join(userDataDir, 'workspaces', 'default.hatfield-workspace')

async function expectSavedFolders(userDataDir: string, paths: string[]): Promise<void> {
  const document: unknown = JSON.parse(await readFile(workspaceFile(userDataDir), 'utf8'))
  expect(document).toEqual({ version: 1, folders: paths.map((path) => ({ path })) })
}

/** The OS folder picker can't be driven by Playwright (user-authorized for #8): answer it from the test. */
async function answerFolderPicker(app: ElectronApplication, folder: string | null): Promise<void> {
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () =>
      Promise.resolve({ canceled: chosen === null, filePaths: chosen === null ? [] : [chosen] })
  }, folder)
}

const folderList = (page: Page) => page.getByRole('list', { name: 'Workspace folders' })

test('File menu has the workspace actions', async () => {
  await withApp(async (app) => {
    const labels = await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()
        ?.items.find((item) => item.label === 'File')
        ?.submenu?.items.filter((item) => item.type !== 'separator')
        .map((item) => item.label)
    )
    expect(labels?.slice(0, -1)).toEqual([
      'Open Folder…',
      'Open Workspace from File…',
      'Open Recent',
      'Add Folder to Workspace…',
      'Save Workspace As…',
      'Duplicate Workspace…',
      'Close Workspace'
    ])
  })
})

test('folders added from the empty state and the File menu are listed and saved once', async () => {
  const [userData, cleanUserData] = await makeTempDir('user-data')
  const [projects, cleanProjects] = await makeTempDir('projects')
  const api = join(projects, 'api')
  const web = join(projects, 'web')
  await mkdir(api)
  await mkdir(web)
  try {
    await withApp(
      async (app, page) => {
        await expect(page.getByText('No folders in this workspace yet.')).toBeVisible()
        await saveScreenshot(page, 'workspace-empty')

        await answerFolderPicker(app, api)
        await page.getByRole('button', { name: 'Open Folder', exact: true }).click()
        await expect(folderList(page).getByRole('listitem', { name: 'api' })).toBeVisible()

        await answerFolderPicker(app, web)
        await clickMenuItem(app, 'add-folder-to-workspace')
        await expect(folderList(page).getByRole('listitem')).toHaveText(['api', 'web'])

        // Adding a folder already in the workspace and cancelling the picker change nothing.
        await answerFolderPicker(app, api)
        await clickMenuItem(app, 'open-folder')
        await answerFolderPicker(app, null)
        await page.getByRole('button', { name: 'Add Folder to Workspace' }).click()
        await expect(folderList(page).getByRole('listitem')).toHaveText(['api', 'web'])
        await expectSavedFolders(userData, [api, web])

        await folderList(page).getByRole('listitem', { name: 'web' }).hover()
        await expect(page.getByRole('tooltip')).toHaveText(web)
        await saveScreenshot(page, 'workspace-folders')
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
    await cleanProjects()
  }
})

test('the workspace survives a restart, shows deleted folders as missing and removes folders', async () => {
  const [userData, cleanUserData] = await makeTempDir('user-data')
  const [projects, cleanProjects] = await makeTempDir('projects')
  const kept = join(projects, 'kept')
  const deleted = join(projects, 'deleted')
  await mkdir(kept)
  await mkdir(join(userData, 'workspaces'), { recursive: true })
  await writeFile(
    workspaceFile(userData),
    JSON.stringify({ version: 1, folders: [{ path: kept }, { path: deleted }] })
  )
  try {
    await withApp(
      async (_app, page) => {
        await expect(folderList(page).getByRole('listitem')).toHaveText(['kept', 'deletedmissing'])
        await expect(
          folderList(page).getByRole('listitem', { name: 'deleted (missing)' })
        ).toBeVisible()
        await saveScreenshot(page, 'workspace-missing')

        await folderList(page).getByRole('listitem', { name: 'deleted (missing)' }).click({
          button: 'right'
        })
        await page.getByRole('menuitem', { name: 'Remove from Workspace' }).click()
        await expect(folderList(page).getByRole('listitem')).toHaveText(['kept'])
        await expectSavedFolders(userData, [kept])
      },
      { userDataDir: userData }
    )

    await rm(kept, { recursive: true })
    await withApp(
      async (_app, page) => {
        await expect(
          folderList(page).getByRole('listitem', { name: 'kept (missing)' })
        ).toBeVisible()
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
    await cleanProjects()
  }
})

test('an unreadable workspace file is moved aside and the workspace starts empty', async () => {
  const [userData, cleanUserData] = await makeTempDir('user-data')
  await mkdir(join(userData, 'workspaces'), { recursive: true })
  await writeFile(workspaceFile(userData), '{"version":1,"folders":[{"pa')
  try {
    await withApp(
      async (_app, page) => {
        await expect(page.getByText('No folders in this workspace yet.')).toBeVisible()
        const files = await readdir(join(userData, 'workspaces'))
        const aside = files.find((name) => name.startsWith('default.hatfield-workspace.corrupt-'))
        expect(aside).toBeDefined()
        expect(await readFile(join(userData, 'workspaces', aside ?? ''), 'utf8')).toBe(
          '{"version":1,"folders":[{"pa'
        )
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
  }
})

test('a workspace file from a newer app version is reported and left untouched', async () => {
  const [userData, cleanUserData] = await makeTempDir('user-data')
  const newer = '{"version":2,"folders":[],"layout":{}}'
  await mkdir(join(userData, 'workspaces'), { recursive: true })
  await writeFile(workspaceFile(userData), newer)
  try {
    await withApp(
      async (app, page) => {
        const panelAlert = page
          .getByRole('complementary', { name: 'Agents panel' })
          .getByRole('alert')
        await expect(panelAlert).toContainText('newer version of Hatfield 360')
        await answerFolderPicker(app, userData)
        await page.getByRole('button', { name: 'Add Folder to Workspace' }).click()
        await expect(page.getByRole('alert', { name: 'Workspace message' })).toContainText(
          'newer version of Hatfield 360'
        )
        await expect(panelAlert).toContainText('newer version of Hatfield 360')
        expect(await readFile(workspaceFile(userData), 'utf8')).toBe(newer)
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
  }
})
