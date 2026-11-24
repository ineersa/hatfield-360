import { expect, test, type Page } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { makeTempDir, withApp } from './launch-app'
import { seedWorkspace } from './workspace-seed'

const activePanes = (page: Page) => page.getByRole('tabpanel').getByTestId('terminal-pane')
const divider = (page: Page) => page.getByRole('separator', { name: 'Resize panes left and right' })
const open = (page: Page, path: string) =>
  page.evaluate((file) => globalThis.desktop.openRecent({ kind: 'workspace', path: file }), path)
const stacked = (page: Page) =>
  page.getByRole('separator', { name: 'Resize panes above and below' })

async function openTerminal(page: Page, project: string): Promise<void> {
  await page.getByRole('listitem', { name: project }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Open Terminal Here' }).click()
  await expect(page.getByRole('tab', { name: project, selected: true })).toBeVisible()
}

async function splitProportion(page: Page): Promise<number> {
  const first = await activePanes(page).first().boundingBox()
  const second = await activePanes(page).last().boundingBox()
  if (!first || !second) throw new Error('Expected two visible terminal panes')
  return first.width / (first.width + second.width)
}

test('terminal layout survives quitting, without reopening explicitly closed tabs or panes', async () => {
  const [projects, cleanProjects] = await makeTempDir('projects')
  const names = ['layout-first', 'layout-selected', 'layout-closed']
  const folders = names.map((name) => ({ path: join(projects, name), kind: 'project' as const }))
  await Promise.all(folders.map(({ path }) => mkdir(path)))
  const [userDataDir, cleanUserData] = await seedWorkspace(folders)
  try {
    let proportion = 0
    await withApp(
      async (_app, page) => {
        for (const name of names) await openTerminal(page, name)
        await page.getByRole('button', { name: 'Close layout-closed' }).click()
        await page.getByRole('tab', { name: 'layout-selected' }).click()
        await page.getByRole('button', { name: 'Split Right' }).click()
        await page.getByRole('button', { name: 'Split Down' }).click()
        await expect(activePanes(page)).toHaveCount(3)
        const last = activePanes(page).last()
        await last.hover()
        await last.getByRole('button', { name: 'Close pane' }).click()
        await expect(activePanes(page)).toHaveCount(2)
        const bounds = await divider(page).boundingBox()
        if (!bounds) throw new Error('Expected a visible pane divider')
        const x = bounds.x + bounds.width / 2
        const y = bounds.y + bounds.height / 2
        await page.mouse.move(x, y)
        await page.mouse.down()
        await page.mouse.move(x + 80, y)
        await page.mouse.up()
        proportion = await splitProportion(page)
        expect(proportion).toBeGreaterThan(0.55)
      },
      { userDataDir }
    )
    const workspace = await readFile(
      join(userDataDir, 'workspaces', 'default.hatfield-workspace'),
      'utf8'
    )
    expect(workspace).toContain('"terminals"')
    expect(workspace).not.toContain('"terminalId"')
    await withApp(
      async (_app, page) => {
        await expect(page.getByRole('tab')).toHaveText(['layout-first', 'layout-selected'])
        await expect(
          page.getByRole('tab', { name: 'layout-selected', selected: true })
        ).toBeVisible()
        await expect(activePanes(page)).toHaveCount(2)
        await expect(divider(page)).toBeVisible()
        expect(await splitProportion(page)).toBeCloseTo(proportion, 2)
        await expect(activePanes(page).last().getByRole('textbox')).toBeFocused()
      },
      { userDataDir }
    )
  } finally {
    await cleanUserData()
    await cleanProjects()
  }
})

const id = (number: number) => `00000000-0000-0000-0000-${String(number).padStart(12, '0')}`

test('restores a saved agent through its configured launch with fresh credentials', async () => {
  const [project, cleanProject] = await makeTempDir('resume-proof')
  const folders = [{ path: project, kind: 'project' as const }]
  const [userDataDir, cleanup] = await seedWorkspace(folders)
  try {
    await writeFile(
      join(userDataDir, 'settings.json'),
      JSON.stringify({
        'agents.hatfield': {
          executable: process.execPath,
          args: [resolve(__dirname, 'fixtures/agent-scenario.mjs'), 'hatfield', '7', 'resume-proof']
        }
      })
    )
    await writeFile(
      join(userDataDir, 'workspaces', 'default.hatfield-workspace'),
      JSON.stringify({
        version: 1,
        folders,
        terminals: {
          activeTabId: id(1),
          tabs: [
            {
              id: id(1),
              cwd: project,
              label: 'Restored agent',
              activePane: id(2),
              layout: {
                kind: 'pane',
                id: id(2),
                cwd: project,
                agent: { provider: 'hatfield', providerSessionId: '7', title: null, project }
              }
            }
          ]
        }
      })
    )
    const start = async () => {
      let title: string | null = null
      await withApp(
        async (_app, page) => {
          const row = page.getByRole('button', {
            name: /^Hatfield #7 · Resume proof [a-f0-9]{16} · Needs input$/
          })
          await expect(row).toHaveCount(1)
          await expect(activePanes(page)).toHaveCount(1)
          title = await row.getAttribute('aria-label')
        },
        { userDataDir }
      )
      return title
    }
    const first = await start()
    const second = await start()
    expect(second).not.toBe(first)
  } finally {
    await cleanup()
    await cleanProject()
  }
})

test('a saved agent without a conversation ID reports the failure without replacing its pane', async () => {
  const [project, cleanProject] = await makeTempDir('resume-missing-id')
  const folders = [{ path: project, kind: 'project' as const }]
  const [userDataDir, cleanup] = await seedWorkspace(folders)
  try {
    await writeFile(
      join(userDataDir, 'workspaces', 'default.hatfield-workspace'),
      JSON.stringify({
        version: 1,
        folders,
        terminals: {
          activeTabId: id(1),
          tabs: [
            {
              id: id(1),
              cwd: project,
              label: 'Unavailable agent',
              activePane: id(2),
              layout: {
                kind: 'pane',
                id: id(2),
                cwd: project,
                agent: { provider: 'hatfield', providerSessionId: null, title: null, project }
              }
            }
          ]
        }
      })
    )
    await withApp(
      async (_app, page) => {
        await expect(
          page.getByRole('alert').filter({ hasText: 'The saved conversation ID is unavailable.' })
        ).toBeVisible()
        await expect(activePanes(page)).toHaveCount(1)
      },
      { userDataDir }
    )
  } finally {
    await cleanup()
    await cleanProject()
  }
})

test('switching named workspaces isolates their terminals and preserves the rearranged split', async () => {
  const [project, cleanProject] = await makeTempDir('shared-project')
  const folders = [{ path: project, kind: 'project' as const }]
  const [userDataDir, cleanup] = await seedWorkspace(folders)
  const first = join(userDataDir, 'workspaces', 'first.hatfield-workspace')
  const second = join(userDataDir, 'workspaces', 'second.hatfield-workspace')
  const missing = join(project, 'removed-worktree')
  try {
    await writeFile(first, JSON.stringify({ version: 1, folders }))
    await writeFile(
      second,
      JSON.stringify({
        version: 1,
        folders,
        terminals: {
          activeTabId: id(1),
          tabs: [
            {
              id: id(1),
              cwd: missing,
              label: 'Removed worktree',
              activePane: id(2),
              layout: { kind: 'pane', id: id(2), cwd: missing }
            }
          ]
        }
      })
    )
    await withApp(
      async (_app, page) => {
        await open(page, first)
        await expect(page).toHaveTitle('first — Hatfield 360')
        await openTerminal(page, basename(project))
        await page.getByRole('button', { name: 'Split Right' }).click()
        await activePanes(page).first().click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Rearrange Panes' }).click()
        const handles = page.getByTestId('pane-rearrange-handle')
        await expect(handles).toHaveCount(2)
        const [left, right] = await Promise.all([
          handles.first().boundingBox(),
          handles.last().boundingBox()
        ])
        if (!left || !right) throw new Error('Expected two rearrangement handles')
        await page.mouse.move(right.x + right.width / 2, right.y + right.height / 2)
        await page.mouse.down()
        await page.mouse.move(left.x + left.width / 2, left.y + left.height / 10)
        await page.mouse.up()
        await expect(stacked(page)).toBeVisible()

        await open(page, second)
        await expect(page.getByRole('tab')).toHaveText('Removed worktree')
        await expect(page.getByRole('alert', { name: 'Could not restore terminal' })).toContainText(
          `The folder ${missing} doesn't exist.`
        )
        await expect(activePanes(page)).toHaveCount(1)

        await open(page, first)
        await expect(page).toHaveTitle('first — Hatfield 360')
        await expect(page.getByRole('tab')).toHaveCount(1)
        await expect(stacked(page)).toBeVisible()
      },
      { userDataDir }
    )
    await withApp(
      async (_app, page) => {
        await expect(page).toHaveTitle('first — Hatfield 360')
        await expect(activePanes(page)).toHaveCount(2)
        await expect(stacked(page)).toBeVisible()
      },
      { userDataDir }
    )
  } finally {
    await cleanup()
    await cleanProject()
  }
})
