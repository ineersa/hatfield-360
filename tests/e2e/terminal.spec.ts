import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
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
        // xterm draws its own scrollbar; no native one may take room (or show its arrow) beneath it.
        const nativeScrollbar = await page.evaluate<number>(
          `(() => { const v = document.querySelector('[data-testid="terminal-pane"] .xterm-viewport'); return v ? v.offsetWidth - v.clientWidth : -1 })()`
        )
        expect(nativeScrollbar).toBe(0)

        await run(page, pane, 'pwd')
        await expect(screenText(pane)).toContainText(project)
        await run(page, pane, printTermProgram)
        await expect(screenText(pane)).toContainText('Hatfield360')
        await run(page, pane, 'echo héllo-世界-✓')
        await expect(screenText(pane)).toContainText('héllo-世界-✓')
        if (!isWindows) {
          await run(page, pane, "printf '\\033[31m%s\\033[0m\\n' red-$((40+2))")
          await expect(pane.locator('.xterm-fg-1', { hasText: 'red-42' })).toBeVisible()

          // Output past the screen stays in the scrollback; the mouse wheel scrolls back into it.
          await run(page, pane, "seq -f 'row%gx' 1 300")
          await expect(screenText(pane)).toContainText('row300x')
          await pane.hover()
          await page.mouse.wheel(0, -100)
          await page.mouse.wheel(0, -100)
          await expect(screenText(pane)).not.toContainText('row300x')
          await run(page, pane, 'clear')

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

test('the empty Agents view opens a terminal in the first project with one click', async () => {
  const { userData, project, cleanup } = await seedProject()
  try {
    await withApp(
      async (_app, page) => {
        await expect(page.getByRole('button', { name: 'New Terminal' })).toBeVisible()
        await saveScreenshot(page, 'terminal-empty-state')
        await page
          .getByRole('main', { name: 'Agents' })
          .getByRole('button', { name: 'New Terminal' })
          .click()
        await expect(page.getByRole('tab', { name: 'pty-project', selected: true })).toBeVisible()
        await run(page, panes(page), 'pwd')
        await expect(screenText(panes(page))).toContainText(project)
        await saveScreenshot(page, 'terminal-from-empty-state')

        // Exiting the only shell closes its tab and brings the empty view back.
        await run(page, panes(page), 'exit')
        await expect(page.getByRole('tab')).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'New Terminal' })).toBeVisible()
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanup()
  }
})

/**
 * On a real display the test shares the user's clipboard. Plain text is saved and put back;
 * anything else (an image) can't be (reading its contents crashes Electron 45's main process),
 * so the test is skipped rather than lose it. Under xvfb and in CI the clipboard is the test's.
 */
async function keepUserClipboard(app: ElectronApplication): Promise<(() => Promise<void>) | null> {
  const textOnly = await app.evaluate(async ({ clipboard }) =>
    (await clipboard.read()).every((item) =>
      item.types.every((type) => type.startsWith('text/plain'))
    )
  )
  if (!textOnly) return null
  const text = await app.evaluate(({ clipboard }) => clipboard.readText())
  return () => app.evaluate(({ clipboard }, saved) => clipboard.writeText(saved), text)
}

test('the system copy and paste keys copy and paste, and Ctrl+C still interrupts', async () => {
  const { userData, cleanup } = await seedProject()
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
  try {
    await withApp(
      async (app, page) => {
        const restoreClipboard = await keepUserClipboard(app)
        test.skip(
          restoreClipboard === null,
          "The clipboard holds more than text, which the test couldn't put back."
        )
        try {
          await openProjectTerminal(page)
          const pane = panes(page)
          await panePid(pane)

          await app.evaluate(({ clipboard }) => clipboard.writeText('pasted-77'))
          await pane.click()
          await page.keyboard.type('echo ')
          await page.keyboard.press(`${modifier}+V`)
          await page.keyboard.press('Enter')
          // Pasted once, as text: the command line and its output, no ^V and no second paste.
          await expect(screenText(pane)).toContainText('echo pasted-77')
          await expect
            .poll(
              async () =>
                ((await screenText(pane).textContent()) ?? '').split('pasted-77').length - 1
            )
            .toBe(2)

          // With no text on the clipboard (an image), Ctrl+V reaches the program as ^V, as does
          // Ctrl+Shift+V always: `od` shows the byte (026 octal).
          if (!isWindows) {
            await app.evaluate(({ clipboard }) => clipboard.clear())
            // -iexten: the tty would otherwise take the first ^V as "insert the next key literally".
            await run(page, pane, 'stty -iexten; od -c')
            await page.keyboard.press('Control+V')
            await expect(screenText(pane)).toContainText('od -c^V')
            await page.keyboard.press('Control+Shift+V')
            await expect(screenText(pane)).toContainText('od -c^V^V')
            await page.keyboard.press('Enter')
            await page.keyboard.press('Control+D')
            await expect(screenText(pane)).toContainText(/026\s+026/)
          }

          await run(page, pane, 'echo copy-me-42')
          const output = screenText(pane).getByText('copy-me-42', { exact: true })
          // xterm's screen layer takes the mouse above its text rows: double-click where the word shows.
          const word = await output.boundingBox()
          if (!word) throw new Error('copy-me-42 is not on screen')
          await page.mouse.dblclick(word.x + word.width / 2, word.y + word.height / 2)
          await page.keyboard.press(`${modifier}+C`)
          await expect
            .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
            .toBe('copy-me-42')

          // The right-click menu copies a selection, pastes, splits and closes the pane under the mouse.
          await app.evaluate(({ clipboard }) => clipboard.writeText('something-else'))
          await page.mouse.dblclick(word.x + word.width / 2, word.y + word.height / 2)
          await page.mouse.click(word.x + word.width / 2, word.y + word.height / 2, {
            button: 'right'
          })
          const menu = page.getByRole('menu')
          await saveScreenshot(page, 'terminal-context-menu')
          await menu.getByRole('menuitem', { name: 'Copy' }).click()
          await expect
            .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
            .toBe('copy-me-42')
          // Closing the menu gives the keys back to the terminal.
          await expect(pane.getByRole('textbox', { name: 'Terminal input' })).toBeFocused()
          await page.keyboard.type('echo menu-')
          await pane.click({ button: 'right' })
          await expect(menu.getByRole('menuitem', { name: 'Copy' })).toBeDisabled()
          await menu.getByRole('menuitem', { name: 'Paste' }).click()
          await expect(screenText(pane)).toContainText('echo menu-copy-me-42')
          await page.keyboard.press('Enter')
          await expect(screenText(pane).getByText('menu-copy-me-42', { exact: true })).toBeVisible()
          await pane.click({ button: 'right' })
          await menu.getByRole('menuitem', { name: 'Split Right' }).click()
          await expect(panes(page)).toHaveCount(2)
          await panes(page).last().click({ button: 'right' })
          await menu.getByRole('menuitem', { name: 'Close Pane' }).click()
          await expect(panes(page)).toHaveCount(1)

          // With nothing selected, Ctrl+C is the shell's interrupt.
          await run(page, panes(page), 'sleep 30')
          await page.keyboard.press('Control+C')
          await run(page, pane, 'echo after-interrupt')
          await expect(screenText(pane).getByText('after-interrupt', { exact: true })).toBeVisible({
            timeout: 10_000
          })
        } finally {
          await restoreClipboard?.()
        }
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

        // The strip's Split Down adds a pane; its own close button (shown on hover) removes it.
        await page.getByRole('button', { name: 'Split Down' }).click()
        await expect(panes(page)).toHaveCount(3)
        const added = panes(page).last()
        const addedPid = await panePid(added)
        await added.hover()
        await saveScreenshot(page, 'terminal-pane-close')
        await added.getByRole('button', { name: 'Close pane' }).click()
        await expect(panes(page)).toHaveCount(2)
        await expect.poll(() => isRunning(addedPid)).toBe(false)

        // A shell that ends itself takes its pane with it, whatever its code (bash exits with the
        // last command's status, 130 after a ^C); one killed by a signal keeps it, with a badge.
        await run(page, first, 'exit 130')
        await expect(panes(page)).toHaveCount(1)
        await expect.poll(() => isRunning(firstPid)).toBe(false)
        if (!isWindows) {
          await run(page, panes(page), 'kill -9 $$')
          await expect(panes(page).getByRole('status')).toHaveText('Process ended by signal 9')
          await expect(page.getByRole('tab')).toHaveCount(1)
        }
        // A lone pane closes with its tab, so it has no close button of its own.
        await expect(panes(page).getByRole('button', { name: 'Close pane' })).toBeHidden()
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
        await page.getByRole('button', { name: 'Split Right' }).click()
        await expect(panes(page)).toHaveCount(2)
        await page.getByRole('button', { name: 'New Terminal' }).click()
        await expect(page.getByRole('tab')).toHaveCount(2)
        await saveScreenshot(page, 'terminal-tabs')
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
