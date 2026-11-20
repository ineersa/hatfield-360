import { expect, test, type Page } from '@playwright/test'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { clickMenuItem, clickSubmenuItem, submenuLabels } from './app-menu'
import { makeTempDir, saveScreenshot, withApp } from './launch-app'

type RecentItem = { kind: 'workspace' | 'folder'; path: string }

async function writeAppState(
  userDataDir: string,
  state: { current: string | null; recent: RecentItem[] }
): Promise<void> {
  await writeFile(join(userDataDir, 'state.json'), JSON.stringify({ version: 1, ...state }))
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'))
}

const folderList = (page: Page) => page.getByRole('list', { name: 'Workspace folders' })
const recentList = (page: Page) => page.getByRole('list', { name: 'Recent' })
const message = (page: Page) => page.getByRole('alert', { name: 'Workspace message' })

test('recent workspaces open from the welcome screen, reopen at launch and close back to the default', async () => {
  const [userData, cleanUserData] = await makeTempDir('user-data')
  const [projects, cleanProjects] = await makeTempDir('projects')
  const repo = join(projects, 'repo')
  const outside = join(projects, 'outside')
  const team = join(repo, 'team.hatfield-workspace')
  const gone = join(projects, 'gone.hatfield-workspace')
  await mkdir(join(repo, 'api'), { recursive: true })
  await mkdir(outside)
  await writeFile(
    team,
    JSON.stringify({ version: 1, folders: [{ path: 'api' }, { path: outside }] })
  )
  // Saved in Hatfield's own workspaces folder but not in Recent.
  await mkdir(join(userData, 'workspaces'))
  await writeFile(
    join(userData, 'workspaces', 'side.hatfield-workspace'),
    JSON.stringify({ version: 1, folders: [{ path: outside }] })
  )
  await writeAppState(userData, {
    current: null,
    recent: [
      { kind: 'workspace', path: team },
      { kind: 'workspace', path: gone },
      // Saved in Hatfield's folder once, deleted since.
      { kind: 'workspace', path: join(userData, 'workspaces', 'old.hatfield-workspace') },
      { kind: 'folder', path: outside }
    ]
  })
  try {
    await withApp(
      async (_app, page) => {
        await expect(page).toHaveTitle('Default Workspace — Hatfield 360')
        await expect(recentList(page).getByRole('button', { name: /^(?!Remove)/ })).toHaveText([
          /^Default Workspace/,
          /^team/,
          /^gone/,
          /^old/,
          /^side/,
          /^outside/
        ])
        await expect(
          recentList(page).getByRole('button', { name: 'Default Workspace' })
        ).toBeDisabled()
        await expect(
          recentList(page).getByRole('button', { name: 'gone (missing)' })
        ).toBeDisabled()
        await saveScreenshot(page, 'welcome')

        await recentList(page).getByRole('button', { name: 'team', exact: true }).click()
        await expect(folderList(page).getByRole('listitem')).toHaveText(['api', 'outside'])
        await expect(page).toHaveTitle('team — Hatfield 360')

        // Rewriting the file keeps the folder inside the workspace's directory relative.
        await folderList(page).getByRole('listitem', { name: 'outside' }).click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Remove from Workspace' }).click()
        await expect(folderList(page).getByRole('listitem')).toHaveText(['api'])
        expect(await readJson(team)).toEqual({ version: 1, folders: [{ path: 'api' }] })
      },
      { userDataDir: userData }
    )

    await withApp(
      async (app, page) => {
        await expect(folderList(page).getByRole('listitem')).toHaveText(['api'])
        await expect(page).toHaveTitle('team — Hatfield 360')

        await clickMenuItem(app, 'close-workspace')
        await expect(page).toHaveTitle('Default Workspace — Hatfield 360')
        await expect(page.getByText('Default Workspace has no folders yet.')).toBeVisible()
        await expect
          .poll(() => submenuLabels(app, 'open-recent'))
          .toEqual([
            'Default Workspace',
            `${join(repo, 'team')} (Workspace)`,
            `${join(projects, 'gone')} (Workspace) (missing)`,
            'old (Workspace) (missing)',
            'side (Workspace)',
            outside,
            'Clear Recently Opened'
          ])

        await recentList(page).getByRole('button', { name: 'Remove gone from Recent' }).click()
        await recentList(page).getByRole('button', { name: 'Remove old from Recent' }).click()
        await expect(recentList(page).getByRole('button', { name: 'gone (missing)' })).toHaveCount(
          0
        )
        expect(await readJson(join(userData, 'state.json'))).toEqual({
          version: 1,
          current: null,
          recent: [
            { kind: 'workspace', path: team },
            { kind: 'folder', path: outside }
          ]
        })

        // Workspaces in Hatfield's folder stay listed: they can't be removed from Recent, only opened.
        await clickMenuItem(app, 'clear-recent')
        await expect(recentList(page).getByRole('button', { name: /^(?!Remove)/ })).toHaveText([
          /^Default Workspace/,
          /^side/
        ])
        await expect(
          recentList(page).getByRole('button', { name: 'Remove side from Recent' })
        ).toHaveCount(0)
        await recentList(page).getByRole('button', { name: 'side', exact: true }).click()
        await expect(folderList(page).getByRole('listitem')).toHaveText(['outside'])
        await expect(page).toHaveTitle('side — Hatfield 360')
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
    await cleanProjects()
  }
})

test('a workspace file kept next to its folders still works after both move', async () => {
  const [userData, cleanUserData] = await makeTempDir('user-data')
  const [projects, cleanProjects] = await makeTempDir('projects')
  await mkdir(join(projects, 'repo', 'api'), { recursive: true })
  await writeFile(
    join(projects, 'repo', 'team.hatfield-workspace'),
    JSON.stringify({ version: 1, folders: [{ path: 'api' }] })
  )
  await rename(join(projects, 'repo'), join(projects, 'moved'))
  const moved = join(projects, 'moved', 'team.hatfield-workspace')
  await writeAppState(userData, { current: moved, recent: [{ kind: 'workspace', path: moved }] })
  try {
    await withApp(
      async (_app, page) => {
        // Found at its new place: a folder that isn't there is labelled "api (missing)".
        await expect(
          folderList(page).getByRole('listitem', { name: 'api', exact: true })
        ).toBeVisible()
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
    await cleanProjects()
  }
})

test('a broken workspace file is reported in every view, left untouched, and the open workspace stays', async () => {
  const [userData, cleanUserData] = await makeTempDir('user-data')
  const [projects, cleanProjects] = await makeTempDir('projects')
  const broken = join(projects, 'broken.hatfield-workspace')
  const contents = '{"version":1,"folders":[{"pa'
  await writeFile(broken, contents)
  // A default workspace with a folder, so no welcome screen is shown.
  await mkdir(join(userData, 'workspaces'))
  await writeFile(
    join(userData, 'workspaces', 'default.hatfield-workspace'),
    JSON.stringify({ version: 1, folders: [{ path: projects }] })
  )
  await writeAppState(userData, { current: broken, recent: [{ kind: 'workspace', path: broken }] })
  try {
    await withApp(
      async (app, page) => {
        await expect(message(page)).toHaveText(
          `Can't open workspace "broken": the file is broken (not valid JSON). Opened the default workspace instead.`
        )
        await expect(page).toHaveTitle('Default Workspace — Hatfield 360')
        await saveScreenshot(page, 'workspace-message')
        await message(page).getByRole('button', { name: 'Dismiss' }).click()
        await expect(message(page)).toHaveCount(0)

        // Outside the Agents view there is no workspace panel; the message must still show.
        await page
          .getByRole('navigation', { name: 'Views' })
          .getByRole('button', { name: 'Files', exact: true })
          .click()
        await clickSubmenuItem(app, 'open-recent', `${join(projects, 'broken')} (Workspace)`)
        await expect(message(page)).toHaveText(
          `Can't open workspace "broken": the file is broken (not valid JSON).`
        )
        await expect(page).toHaveTitle('Default Workspace — Hatfield 360')

        // Dismissing hides this occurrence only: trying again shows the same error again.
        await message(page).getByRole('button', { name: 'Dismiss' }).click()
        await expect(message(page)).toHaveCount(0)
        await clickSubmenuItem(app, 'open-recent', `${join(projects, 'broken')} (Workspace)`)
        await expect(message(page)).toHaveText(
          `Can't open workspace "broken": the file is broken (not valid JSON).`
        )
        expect(await readFile(broken, 'utf8')).toBe(contents)
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
    await cleanProjects()
  }
})

test('changes whose app state cannot be saved leave main and the window in agreement', async () => {
  const [userData, cleanUserData] = await makeTempDir('user-data')
  const [projects, cleanProjects] = await makeTempDir('projects')
  const api = join(projects, 'api')
  await mkdir(api)
  await mkdir(join(userData, 'workspaces'))
  await writeFile(
    join(userData, 'workspaces', 'side.hatfield-workspace'),
    JSON.stringify({ version: 1, folders: [{ path: projects }] })
  )
  await writeAppState(userData, { current: null, recent: [{ kind: 'folder', path: api }] })
  try {
    await withApp(
      async (_app, page) => {
        await expect(
          recentList(page).getByRole('button', { name: 'api', exact: true })
        ).toBeVisible()
        // A non-empty directory where state.json belongs: replacing it fails on every platform.
        await rm(join(userData, 'state.json'))
        await mkdir(join(userData, 'state.json', 'blocker'), { recursive: true })

        await recentList(page).getByRole('button', { name: 'side', exact: true }).click()
        await expect(message(page)).toBeVisible()
        await expect(page).toHaveTitle('Default Workspace — Hatfield 360')

        await recentList(page).getByRole('button', { name: 'api', exact: true }).click()
        await expect(message(page)).toBeVisible()
        await expect(page.getByText('Default Workspace has no folders yet.')).toBeVisible()

        // A reloaded window asks main afresh, so it shows what main really has open.
        await page.reload()
        await expect(page).toHaveTitle('Default Workspace — Hatfield 360')
        await expect(page.getByText('Default Workspace has no folders yet.')).toBeVisible()
        await expect(
          readFile(join(userData, 'workspaces', 'default.hatfield-workspace'))
        ).rejects.toThrow()
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
    await cleanProjects()
  }
})
