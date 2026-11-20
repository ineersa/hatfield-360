import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { TerminalCommand } from '../../src/shared/terminal-api'
import { terminalShortcut } from '../../src/shared/terminal-shortcuts'
import { clickMenuItem } from './app-menu'
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

async function press(page: Page, command: TerminalCommand): Promise<void> {
  const accelerator = terminalShortcut(command, process.platform)
  await page.keyboard.press(accelerator.replace('Command', 'Meta').replace('Ctrl', 'Control'))
}

async function openProjectTerminal(page: Page): Promise<void> {
  await page.getByRole('listitem', { name: 'pty-project' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Open Terminal Here' }).click()
}

/** The columns from the last `stty size` answer (`<rows> <cols>`) on the pane's screen. */
async function lastSttyColumns(pane: Locator): Promise<number> {
  const lines = (await screenText(pane).innerText()).split('\n')
  const answer = lines.map((line) => /^\s*(\d+) (\d+)\s*$/.exec(line)).findLast(Boolean)
  return Number(answer?.[2] ?? 0)
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

test('Open Terminal Here runs a shell in the project that types, prints and resizes', async () => {
  const { userData, project, cleanup } = await seedProject()
  try {
    await withApp(
      async (app, page) => {
        await openProjectTerminal(page)
        await expect(page.getByRole('tab', { name: 'pty-project', selected: true })).toBeVisible()
        const pane = panes(page)
        await expect(pane).toHaveCount(1)

        await run(page, pane, 'pwd')
        await expect(screenText(pane)).toContainText(project)
        await run(page, pane, printTermProgram)
        await expect(screenText(pane)).toContainText('Hatfield360')
        await run(page, pane, 'echo héllo-世界-✓')
        await expect(screenText(pane)).toContainText('héllo-世界-✓')
        if (!isWindows) {
          await run(page, pane, "printf '\\033[31m%s\\033[0m\\n' red-$((40+2))")
          await expect(pane.locator('.xterm-fg-1', { hasText: 'red-42' })).toBeVisible()

          // The pty's grid follows the pane: halving the window's width about halves the shell's columns.
          await run(page, pane, 'stty size')
          await expect.poll(async () => lastSttyColumns(pane)).toBeGreaterThan(40)
          const wide = await lastSttyColumns(pane)
          await app.evaluate(({ BrowserWindow }) => {
            const [window] = BrowserWindow.getAllWindows()
            const [width, height] = window?.getSize() ?? [0, 0]
            window?.setSize(Math.round((width ?? 0) / 2), height ?? 0)
          })
          await expect(async () => {
            await run(page, pane, 'stty size')
            expect(await lastSttyColumns(pane)).toBeLessThan(wide * 0.75)
          }).toPass({ timeout: 15_000 })
        }
        await saveScreenshot(page, 'terminal-single')
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanup()
  }
})

test('splits give each pane its own shell; panes close, take focus and resize', async () => {
  const { userData, cleanup } = await seedProject()
  try {
    await withApp(
      async (app, page) => {
        await openProjectTerminal(page)
        const first = panes(page).first()
        const firstPid = await panePid(first)

        await clickMenuItem(app, 'terminal-split-right')
        await expect(panes(page)).toHaveCount(2)
        await press(page, 'split-down')
        // One key press, one split: the page runs the shortcut and the menu doesn't run it again.
        await expect(panes(page)).toHaveCount(3)
        const pids = await Promise.all([0, 1, 2].map((index) => panePid(panes(page).nth(index))))
        expect(new Set(pids).size).toBe(3)
        expect(pids.every(isRunning)).toBe(true)

        // Keys go to the clicked pane, then to the next one by shortcut.
        await run(page, first, 'echo typed-in-first')
        await expect(screenText(first)).toContainText('typed-in-first')
        await press(page, 'focus-next-pane')
        await page.keyboard.type('echo moved-to-second')
        await page.keyboard.press('Enter')
        await expect(screenText(panes(page).nth(1))).toContainText('moved-to-second')
        await expect(screenText(first)).not.toContainText('moved-to-second')

        // Dragging the vertical divider gives the first pane more room.
        const divider = page.getByRole('separator', { name: 'Resize panes left and right' })
        const widthBefore = (await first.boundingBox())?.width ?? 0
        const handle = await divider.boundingBox()
        if (!handle) throw new Error('no divider')
        await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
        await page.mouse.down()
        await page.mouse.move(handle.x + 120, handle.y + handle.height / 2, { steps: 5 })
        await page.mouse.up()
        await expect
          .poll(async () => (await first.boundingBox())?.width ?? 0)
          .toBeGreaterThan(widthBefore + 80)
        await saveScreenshot(page, 'terminal-splits')

        // Closing the focused (second) pane ends its shell and leaves the other two.
        const closedPid = pids[1] ?? 0
        await press(page, 'close-pane')
        await expect(panes(page)).toHaveCount(2)
        await expect.poll(() => isRunning(closedPid)).toBe(false)
        expect(isRunning(firstPid)).toBe(true)

        await run(page, first, 'exit')
        await expect(first.getByRole('status')).toHaveText(/Process exited/)
        await expect.poll(() => isRunning(firstPid)).toBe(false)
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanup()
  }
})

test('tabs: closing one ends its shells, quitting ends all of them', async () => {
  const { userData, cleanup } = await seedProject()
  const pids: number[] = []
  try {
    await withApp(
      async (app, page) => {
        await openProjectTerminal(page)
        await clickMenuItem(app, 'terminal-split-right')
        await expect(panes(page)).toHaveCount(2)
        await clickMenuItem(app, 'terminal-new-terminal')
        await expect(page.getByRole('tab')).toHaveCount(2)
        const secondTab = page.getByRole('tabpanel', { name: 'pty-project' }).last()
        const secondTabPid = await panePid(secondTab.getByTestId('terminal-pane'))

        await page.getByRole('button', { name: 'Close pty-project' }).last().click()
        await expect(page.getByRole('tab')).toHaveCount(1)
        await expect.poll(() => isRunning(secondTabPid)).toBe(false)

        // The first tab's shells keep running while it was hidden and after it shows again.
        await expect(panes(page)).toHaveCount(2)
        for (const index of [0, 1]) pids.push(await panePid(panes(page).nth(index)))
        expect(pids.every(isRunning)).toBe(true)
        await clickMenuItem(app, 'terminal-new-terminal')
        const lastPane = page.getByRole('tabpanel').last().getByTestId('terminal-pane')
        pids.push(await panePid(lastPane))
        if (!isWindows) {
          // A program that ignores the hangup a closing terminal sends must still end with the app.
          await run(page, lastPane, "trap '' HUP; exec sleep 600")
          await expect(screenText(lastPane)).toContainText('exec sleep 600')
        }
      },
      { userDataDir: userData }
    )
    // withApp quits the app; no shell outlives it.
    expect(pids).toHaveLength(3)
    expect(pids.filter(isRunning)).toEqual([])
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
