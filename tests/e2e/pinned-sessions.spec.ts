import { expect, test, type Page } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { makeTempDir, saveScreenshot, withApp } from './launch-app'
import { seedWorkspace } from './workspace-seed'

const fixture = resolve(__dirname, 'fixtures/agent-scenario.mjs')
const panes = (page: Page) => page.getByRole('tabpanel').getByTestId('terminal-pane')
const pinnedList = (page: Page) => page.getByRole('list', { name: 'Pinned sessions' })
const projectList = (page: Page) => page.getByRole('list', { name: 'Workspace folders' })
const sessionRow = /^Hatfield #42/
const dialog = (page: Page) => page.getByRole('alertdialog', { name: 'Close pinned session?' })

async function report(page: Page): Promise<void> {
  const pane = panes(page).first()
  await pane.click()
  await page.keyboard.type('start')
  await page.keyboard.press('Enter')
  await expect(pane.locator('.xterm-rows')).toContainText('ACK start: accepted')
}

test('a pinned session leads the panel and the strip, asks before closing, and survives a restart', async () => {
  const [projects, cleanProjects] = await makeTempDir('pins')
  const project = join(projects, 'pin-project')
  await mkdir(project)
  const folders = [{ path: project, kind: 'project' as const }]
  const [userDataDir, cleanUserData] = await seedWorkspace(folders)
  await writeFile(
    join(userDataDir, 'settings.json'),
    JSON.stringify({
      'terminal.gpuAcceleration': false,
      'agents.hatfield': {
        executable: process.execPath,
        args: [fixture, 'hatfield', '42', 'pin']
      }
    })
  )
  try {
    await withApp(
      async (_app, page) => {
        const projectRow = page.getByRole('listitem', { name: 'pin-project', exact: true })
        await projectRow.click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Open Terminal Here' }).click()
        await projectRow.click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Launch Hatfield', exact: true }).click()
        await expect(page.getByRole('tab')).toHaveCount(2)
        await report(page)

        await projectList(page).getByRole('button', { name: sessionRow }).click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Pin Session' }).click()
        await expect(pinnedList(page).getByRole('button', { name: sessionRow })).toBeVisible()
        await expect(projectList(page).getByRole('button', { name: sessionRow })).toHaveCount(0)
        // The pinned tab moves ahead of the shell opened before it, and has no close button.
        await expect(page.getByRole('tab').first()).toHaveAccessibleName(/ · pinned$/)
        await expect(page.getByRole('button', { name: /^Close .* · pinned$/ })).toHaveCount(0)
        await saveScreenshot(page, 'pinned-sessions/pinned')

        // Close All Tabs leaves the pinned tab open.
        await page.getByRole('tab', { name: 'pin-project', exact: true }).click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Close All Tabs' }).click()
        await expect(page.getByRole('tab')).toHaveCount(1)

        // Each way of closing the pinned session asks first; Keep Open keeps it running.
        await panes(page).first().click({ button: 'right' })
        await page.getByRole('menuitem', { name: /^Close Pane/ }).click()
        await expect(dialog(page)).toBeVisible()
        await expect(dialog(page).getByRole('button', { name: 'Keep Open' })).toBeFocused()
        await saveScreenshot(page, 'pinned-sessions/close-confirmation')
        await page.keyboard.press('Enter')
        await expect(dialog(page)).toBeHidden()
        await page.getByRole('tab').first().click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Close', exact: true }).click()
        await page.getByRole('button', { name: 'Keep Open' }).click()
        await expect(panes(page)).toHaveCount(1)
        await expect(pinnedList(page).getByRole('button', { name: sessionRow })).toBeVisible()
      },
      { userDataDir }
    )
    const saved = await readFile(
      join(userDataDir, 'workspaces', 'default.hatfield-workspace'),
      'utf8'
    )
    expect(saved).toContain('"pinned"')

    await withApp(
      async (_app, page) => {
        await report(page)
        await expect(pinnedList(page).getByRole('button', { name: sessionRow })).toBeVisible()
        const tab = page.getByRole('tab').first()
        await expect(tab).toHaveAccessibleName(/ · pinned$/)

        // Unpinning from the tab gives it its close button back; pinning again from the tab works too.
        await tab.click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Unpin Session' }).click()
        await expect(pinnedList(page)).toHaveCount(0)
        await expect(
          page.getByRole('button', { name: 'Close pin-project', exact: true })
        ).toBeVisible()
        await page.getByRole('tab').first().click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Pin Session' }).click()
        await expect(pinnedList(page).getByRole('button', { name: sessionRow })).toBeVisible()

        // Unpin and Close ends it.
        await pinnedList(page).getByRole('button', { name: sessionRow }).click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Close terminal' }).click()
        await dialog(page).getByRole('button', { name: 'Unpin and Close' }).click()
        await expect(page.getByRole('tab')).toHaveCount(0)
        await expect(pinnedList(page)).toHaveCount(0)
      },
      { userDataDir }
    )
  } finally {
    await cleanUserData()
    await cleanProjects()
  }
})
