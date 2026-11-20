import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { makeTempDir, saveScreenshot, withApp } from './launch-app'

const isWindows = process.platform === 'win32'
// Output that differs from the typed command, so the check sees the shell's answer, not the echo of the keys.
const printTermProgram = isWindows ? 'echo $env:TERM_PROGRAM' : 'echo $TERM_PROGRAM'

/** A user data folder whose workspace holds one project, with the DOM renderer so the test can read the text. */
async function seedProject(): Promise<{
  userData: string
  project: string
  cleanup: () => Promise<void>
}> {
  const [userData, cleanUserData] = await makeTempDir('user-data')
  const [projects, cleanProjects] = await makeTempDir('projects')
  const project = join(projects, 'pty-project')
  await mkdir(project)
  await mkdir(join(userData, 'workspaces'))
  await writeFile(
    join(userData, 'workspaces', 'default.hatfield-workspace'),
    JSON.stringify({ version: 1, folders: [{ path: project }] })
  )
  await writeFile(join(userData, 'settings.json'), '{ "terminal.gpuAcceleration": false }')
  return {
    userData,
    project,
    cleanup: async () => {
      await cleanUserData()
      await cleanProjects()
    }
  }
}

const panes = (page: Page) => page.getByTestId('terminal-pane')

/** The text xterm's DOM renderer shows for the pane. */
const screenText = (pane: Locator) => pane.locator('.xterm-rows')

async function run(page: Page, pane: Locator, command: string): Promise<void> {
  await pane.click()
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
}

async function openProjectTerminal(page: Page): Promise<void> {
  await page.getByRole('listitem', { name: 'pty-project' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Open Terminal Here' }).click()
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function panePid(pane: Locator): Promise<number> {
  await expect(pane).toHaveAttribute('data-pid', /^\d+$/)
  return Number(await pane.getAttribute('data-pid'))
}

test('a terminal opens in the project, runs commands and closes when its shell exits', async () => {
  const { userData, project, cleanup } = await seedProject()
  try {
    await withApp(
      async (_app, page) => {
        // The empty view's button opens a terminal in the first project.
        await page
          .getByRole('main', { name: 'Agents' })
          .getByRole('button', { name: 'New Terminal' })
          .click()
        await expect(page.getByRole('tab', { name: 'pty-project', selected: true })).toBeVisible()
        const pane = panes(page)
        await run(page, pane, 'pwd')
        await expect(screenText(pane)).toContainText(project)
        await run(page, pane, printTermProgram)
        await expect(screenText(pane)).toContainText('Hatfield360')
        await saveScreenshot(page, 'terminal-single')

        await run(page, pane, 'exit')
        await expect(page.getByRole('tab')).toHaveCount(0)

        // Open Terminal Here does the same from the project's menu, and has the keys at once.
        await openProjectTerminal(page)
        await page.keyboard.type('echo straight-from-menu')
        await page.keyboard.press('Enter')
        await expect(screenText(panes(page))).toContainText('straight-from-menu')
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanup()
  }
})

test('splits and tabs each get their own shell; closing them ends it, and so does quitting', async () => {
  const { userData, cleanup } = await seedProject()
  const pids: number[] = []
  try {
    await withApp(
      async (_app, page) => {
        await openProjectTerminal(page)
        const firstPid = await panePid(panes(page).first())
        await page.getByRole('button', { name: 'Split Right' }).click()
        await page.getByRole('button', { name: 'Split Down' }).click()
        await expect(panes(page)).toHaveCount(3)
        const splitPid = await panePid(panes(page).last())
        await saveScreenshot(page, 'terminal-splits')

        await panes(page).last().hover()
        await panes(page).last().getByRole('button', { name: 'Close pane' }).click()
        await expect(panes(page)).toHaveCount(2)
        await expect.poll(() => isRunning(splitPid)).toBe(false)

        await page.getByRole('button', { name: 'New Terminal' }).click()
        await expect(page.getByRole('tab')).toHaveCount(2)
        const tabPid = await panePid(page.getByRole('tabpanel').last().getByTestId('terminal-pane'))
        await page.getByRole('button', { name: 'Close pty-project' }).last().click()
        await expect(page.getByRole('tab')).toHaveCount(1)
        await expect.poll(() => isRunning(tabPid)).toBe(false)

        pids.push(firstPid, await panePid(panes(page).last()))
        expect(pids.every(isRunning)).toBe(true)
      },
      { userDataDir: userData }
    )
    // withApp quits the app; no shell outlives it.
    expect(pids.filter(isRunning)).toEqual([])
  } finally {
    await cleanup()
  }
})

test('the system keys paste into the terminal and copy its selection', async () => {
  const { userData, cleanup } = await seedProject()
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
  try {
    await withApp(
      async (app, page) => {
        const saved = await app.evaluate(({ clipboard }) => clipboard.readText())
        try {
          await openProjectTerminal(page)
          const pane = panes(page)
          await app.evaluate(({ clipboard }) => clipboard.writeText('pasted-77'))
          await page.keyboard.type('echo ')
          await page.keyboard.press(`${modifier}+V`)
          await page.keyboard.press('Enter')
          await expect(screenText(pane).getByText('pasted-77', { exact: true })).toBeVisible()

          // xterm's screen layer takes the mouse above its rows: double-click where the word shows.
          const word = await screenText(pane).getByText('pasted-77', { exact: true }).boundingBox()
          if (!word) throw new Error('pasted-77 is not on screen')
          await app.evaluate(({ clipboard }) => clipboard.writeText('something-else'))
          await page.mouse.dblclick(word.x + word.width / 2, word.y + word.height / 2)
          await page.keyboard.press(`${modifier}+C`)
          await expect
            .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
            .toBe('pasted-77')
        } finally {
          await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), saved)
        }
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanup()
  }
})

/** Calls `window.desktop.<call>` in the page and returns main's refusal ('accepted' if none). */
function refusal(page: Page, call: string): Promise<string> {
  return page.evaluate<string>(
    `window.desktop.${call}.then(() => 'accepted', (error) => String(error))`
  )
}

test('main refuses terminal requests it cannot trust', async () => {
  await withApp(async (_app, page) => {
    expect(
      await refusal(page, "spawnTerminal({ cwd: '/no/such/hatfield/folder', cols: 80, rows: 24 })")
    ).toContain("doesn't exist")
    expect(await refusal(page, "spawnTerminal({ cwd: 'relative', cols: 80, rows: 24 })")).toContain(
      'absolute path'
    )
    expect(await refusal(page, 'spawnTerminal({ cols: 0, rows: 24 })')).toContain(
      'Invalid terminal request'
    )
    expect(await refusal(page, 'spawnTerminal({ cols: 80, rows: 2.5 })')).toContain(
      'Invalid terminal request'
    )
    expect(await refusal(page, "writeTerminal('../etc', 'x')")).toContain('Invalid terminal input')
    expect(await refusal(page, "openTerminalLink('file:///etc/passwd')")).toContain(
      'Only http and https'
    )
  })
})
