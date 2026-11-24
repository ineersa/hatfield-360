import { expect, test, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { makeTempDir, withApp } from './launch-app'
import { seedWorkspace } from './workspace-seed'

const activePanes = (page: Page) => page.getByRole('tabpanel').getByTestId('terminal-pane')
const divider = (page: Page) => page.getByRole('separator', { name: 'Resize panes left and right' })

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

test('unavailable saved conversations offer recovery independently of a neighboring shell', async () => {
  const [project, cleanProject] = await makeTempDir('terminal-recovery')
  const [userDataDir, cleanup] = await seedWorkspace([{ path: project, kind: 'project' }])
  const missingCwd = join(userDataDir, 'removed-worktree')
  try {
    await writeFile(
      join(userDataDir, 'terminal-workspace.json'),
      JSON.stringify({
        version: 1,
        layout: {
          activeTabId: '00000000-0000-0000-0000-000000000001',
          tabs: [
            {
              id: '00000000-0000-0000-0000-000000000001',
              cwd: userDataDir,
              label: 'Saved session layout',
              activePane: '00000000-0000-0000-0000-000000000002',
              layout: {
                kind: 'split',
                direction: 'vertical',
                ratio: 0.4,
                first: {
                  kind: 'pane',
                  id: '00000000-0000-0000-0000-000000000002',
                  conversation: '00000000-0000-0000-0000-000000000005'
                },
                second: {
                  kind: 'split',
                  direction: 'horizontal',
                  ratio: 0.5,
                  first: {
                    kind: 'pane',
                    id: '00000000-0000-0000-0000-000000000003',
                    conversation: '00000000-0000-0000-0000-000000000006'
                  },
                  second: {
                    kind: 'pane',
                    id: '00000000-0000-0000-0000-000000000004',
                    conversation: null
                  }
                }
              }
            }
          ]
        },
        conversations: [
          {
            id: '00000000-0000-0000-0000-000000000006',
            provider: 'hatfield',
            providerSessionId: '91234567',
            title: 'Deleted worktree session',
            project: userDataDir,
            worktree: missingCwd,
            cwd: missingCwd,
            branch: 'deleted',
            process: 'running',
            activity: 'idle',
            updatedAt: 1,
            closedAt: null
          }
        ]
      })
    )
    await withApp(
      async (_app, page) => {
        await expect(
          page.getByText('The saved conversation details are unavailable.')
        ).toBeVisible()
        await expect(page.getByText(`The folder ${missingCwd} no longer exists.`)).toBeVisible()
        await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible()
        await expect(activePanes(page).last()).toHaveAttribute('data-pid', /^\d+$/)
        await activePanes(page).first().getByText('Close pane', { exact: true }).click()
        await expect(activePanes(page)).toHaveCount(2)
        await expect(page.getByText(`The folder ${missingCwd} no longer exists.`)).toBeVisible()
      },
      { userDataDir }
    )
  } finally {
    await cleanup()
    await cleanProject()
  }
})
