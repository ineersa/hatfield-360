import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { makeTempDir, saveScreenshot, withApp } from './launch-app'
import { CLIPBOARD_TAG, keepUserClipboard } from './user-clipboard'

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
        await panePid(pane)
        await run(page, pane, 'pwd')
        await expect(screenText(pane)).toContainText(project)
        await run(page, pane, printTermProgram)
        await expect(screenText(pane)).toContainText('Hatfield360')
        await saveScreenshot(page, 'terminal-single')

        // terminal.lineHeight spaces out the rows of an open terminal as soon as it is saved.
        const rowHeight = async (): Promise<number> =>
          (await screenText(pane).locator(':scope > div').first().boundingBox())?.height ?? 0
        const single = await rowHeight()
        expect(single).toBeGreaterThan(0)
        await writeFile(
          join(userData, 'settings.json'),
          '{ "terminal.gpuAcceleration": false, "terminal.lineHeight": 2 }'
        )
        await expect.poll(rowHeight).toBeGreaterThanOrEqual(single * 2 - 1)

        await run(page, pane, 'exit')
        await expect(page.getByRole('tab')).toHaveCount(0)

        // Open Terminal Here does the same from the project's menu, and has the keys at once.
        await openProjectTerminal(page)
        // Keys typed before the shell exists have nowhere to go.
        await panePid(panes(page))
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

test('terminal tab upper edge and icon activate it, with shortcuts visible on hover', async () => {
  const { userData, cleanup } = await seedProject()
  try {
    await withApp(
      async (_app, page) => {
        await openProjectTerminal(page)
        await page.getByRole('button', { name: 'New Terminal' }).click()
        const tabs = page.getByRole('tab', { name: 'pty-project' })
        await expect(tabs).toHaveCount(2)
        const first = tabs.first()
        const second = tabs.last()
        await expect(second).toHaveAttribute('aria-selected', 'true')
        const bounds = await first.locator('..').boundingBox()
        if (!bounds) throw new Error('Terminal tab is not rendered')
        await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + 2)
        await expect(first).toHaveAttribute('aria-selected', 'true')
        await second.locator('svg').click()
        await expect(second).toHaveAttribute('aria-selected', 'true')
        await page.getByRole('button', { name: 'Close pty-project' }).last().hover()
        await second.hover()
        const tooltip = page.getByRole('tooltip')
        await expect(tooltip).toContainText(process.platform === 'darwin' ? '⌘⇧[' : 'Ctrl+PageUp')
        await expect(tooltip).toContainText(process.platform === 'darwin' ? '⌘⇧]' : 'Ctrl+PageDown')
        await saveScreenshot(page, 'terminal-tab-shortcuts')

        await second.locator('svg').click()
        await page.keyboard.press(
          process.platform === 'darwin' ? 'Meta+Shift+BracketRight' : 'Control+PageDown'
        )
        await expect(first).toHaveAttribute('aria-selected', 'true')
        await page.keyboard.press(
          process.platform === 'darwin' ? 'Meta+Shift+BracketLeft' : 'Control+PageUp'
        )
        await expect(second).toHaveAttribute('aria-selected', 'true')
        await expect(page.getByRole('tabpanel').locator('textarea')).toBeFocused()
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanup()
  }
})

test(
  'the system keys paste into the terminal and copy its selection',
  { tag: CLIPBOARD_TAG },
  async () => {
    const { userData, cleanup } = await seedProject()
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
    try {
      await withApp(
        async (app, page) => {
          const restoreClipboard = await keepUserClipboard(app)
          try {
            await openProjectTerminal(page)
            const pane = panes(page)
            await panePid(pane)
            await app.evaluate(({ clipboard }) => clipboard.writeText('pasted-77'))
            await page.keyboard.type('echo ')
            await page.keyboard.press(`${modifier}+V`)
            // The paste reads main's clipboard first; Enter before it lands would run a bare `echo`.
            await expect(screenText(pane)).toContainText('echo pasted-77')
            await page.keyboard.press('Enter')
            await expect(screenText(pane).getByText('pasted-77', { exact: true })).toBeVisible()

            // xterm's screen layer takes the mouse above its rows: double-click where the word shows.
            const word = await screenText(pane)
              .getByText('pasted-77', { exact: true })
              .boundingBox()
            if (!word) throw new Error('pasted-77 is not on screen')
            await app.evaluate(({ clipboard }) => clipboard.writeText('something-else'))
            await page.mouse.dblclick(word.x + word.width / 2, word.y + word.height / 2)
            await page.keyboard.press(`${modifier}+C`)
            await expect
              .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
              .toBe('pasted-77')
          } finally {
            await restoreClipboard()
          }
        },
        { userDataDir: userData }
      )
    } finally {
      await cleanup()
    }
  }
)

test(
  'terminal copy optionally trims indentation without changing output',
  { tag: CLIPBOARD_TAG },
  async () => {
    const { userData, cleanup } = await seedProject()
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
    try {
      await withApp(
        async (app, page) => {
          const restoreClipboard = await keepUserClipboard(app)
          try {
            await openProjectTerminal(page)
            const pane = panes(page)
            await panePid(pane)
            const command = isWindows
              ? 'Write-Output "    copy-first  inner  " "" "  copy-last" "copy-end"'
              : "printf '    copy-first  inner  \\n\\n  copy-last\\ncopy-end\\n'"
            await run(page, pane, command)
            const screen = screenText(pane)
            const outputRow = (text: string) =>
              screen.locator(':scope > div').filter({ hasText: text })
            const start = outputRow('copy-first').last()
            const end = outputRow('copy-end').last()
            await expect(end).toContainText('copy-end')
            const select = async (): Promise<{ x: number; y: number }> => {
              const from = await start.boundingBox()
              const to = await end.boundingBox()
              if (!from || !to) throw new Error('Could not locate terminal output rows')
              const point = { x: from.x + 1, y: from.y + from.height / 2 }
              await page.mouse.move(point.x, point.y)
              await page.mouse.down()
              await page.mouse.move(to.x + 1, to.y + to.height / 2, { steps: 5 })
              await page.mouse.up()
              return point
            }
            const copied = async (): Promise<string> =>
              (await app.evaluate(({ clipboard }) => clipboard.readText())).replaceAll('\r\n', '\n')
            const settings = page
              .getByRole('navigation', { name: 'Views' })
              .getByRole('button', { name: 'Settings' })
            await settings.click()
            const trim = page.getByRole('checkbox', { name: 'Trim leading whitespace on copy' })
            await expect(trim).not.toBeChecked()
            await page.getByRole('button', { name: 'Close Settings' }).click()
            await select()
            await page.keyboard.press(`${modifier}+C`)
            await expect.poll(copied).toBe('    copy-first  inner  \n\n  copy-last\n')

            await settings.click()
            await trim.check()
            await expect
              .poll(() => readFile(join(userData, 'settings.json'), 'utf8'))
              .toContain('"terminal.trimLeadingWhitespaceOnCopy": true')
            await page.getByRole('button', { name: 'Close Settings' }).click()
            await select()
            await page.keyboard.press(`${modifier}+C`)
            await expect.poll(copied).toBe('copy-first  inner  \n\ncopy-last\n')
            await app.evaluate(({ clipboard }) => clipboard.writeText('before context copy'))
            const point = await select()
            await page.mouse.click(point.x + 30, point.y, { button: 'right' })
            await page.getByRole('menuitem', { name: /^Copy/ }).click()
            await expect.poll(copied).toBe('copy-first  inner  \n\ncopy-last\n')
            if (process.platform !== 'darwin') {
              await app.evaluate(({ clipboard }) => clipboard.writeText('before native copy'))
              await select()
              await app.evaluate(({ BrowserWindow }) =>
                BrowserWindow.getAllWindows()[0]?.webContents.copy()
              )
              await expect.poll(copied).toBe('copy-first  inner  \n\ncopy-last\n')
            }
            await expect(start).toContainText('copy-first')
          } finally {
            await restoreClipboard()
          }
        },
        { userDataDir: userData }
      )
    } finally {
      await cleanup()
    }
  }
)

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
    expect(await refusal(page, "openWebLink('file:///etc/passwd')")).toContain(
      'Only http and https'
    )
  })
})

test('an OSC 8 link uses the trusted link handler only with a modifier', async () => {
  test.skip(isWindows, 'The fixture uses a POSIX shell')
  const { userData, project, cleanup } = await seedProject()
  try {
    const label = 'Open sample reference'
    const url = `https://example.invalid/${'x'.repeat(2048)}`
    await writeFile(
      join(project, 'osc-link.sh'),
      `printf '\\033]8;;${url}\\033\\\\${label}\\033]8;;\\033\\\\\\n'\n`
    )
    await withApp(
      async (_app, page) => {
        await openProjectTerminal(page)
        const pane = panes(page).first()
        await panePid(pane)
        await run(page, pane, 'sh ./osc-link.sh')
        const link = screenText(pane).getByText(label, { exact: true })
        const notice = page.getByRole('alert', {
          name: 'Could not open terminal link',
          exact: true
        })
        await expect(link).toBeVisible()
        const bounds = await link.boundingBox()
        if (!bounds) throw new Error('The rendered link has no bounds')
        const x = bounds.x + 10
        const y = bounds.y + bounds.height / 2
        await page.mouse.move(x, y)
        await page.mouse.click(x, y)
        await expect(notice).toHaveCount(0)
        const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
        await page.keyboard.down(modifier)
        await page.mouse.click(x, y)
        await page.keyboard.up(modifier)
        await expect(notice).toContainText('Only http and https links can be opened.')
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanup()
  }
})
