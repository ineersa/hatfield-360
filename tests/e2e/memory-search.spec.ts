import { expect, test, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { makeTempDir, saveScreenshot, withApp } from './launch-app'
import { seedWorkspace } from './workspace-seed'

const PROJECT = 'memory-project'
const dialog = (page: Page) => page.getByRole('dialog', { name: `Search memory · ${PROJECT}` })

async function seed(settings: Record<string, unknown>) {
  const [projects, cleanProjects] = await makeTempDir('memory-projects')
  const project = join(projects, PROJECT)
  await mkdir(project)
  const [userDataDir, cleanUserData] = await seedWorkspace([{ path: project, kind: 'project' }])
  await writeFile(
    join(userDataDir, 'settings.json'),
    JSON.stringify({ 'terminal.gpuAcceleration': false, ...settings })
  )
  return {
    userDataDir,
    cleanup: async () => {
      await cleanUserData()
      await cleanProjects()
    }
  }
}

/** The DOM members the key recorder uses: the E2E tests compile without DOM types. */
type KeyTarget = {
  dataset: Record<string, string | undefined>
  addEventListener: (
    type: 'keydown',
    listener: (event: { key: string }) => void,
    capture: boolean
  ) => void
}

/** A loopback port with nothing listening on it, so a connection is refused at once. */
async function closedPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
  if (address === null || typeof address === 'string') throw new Error('Expected a TCP port')
  return address.port
}

test('Search Memory opens over a focused terminal, keeps its keys from the shell and explains a missing Librarian', async () => {
  const { userDataDir, cleanup } = await seed({ 'memory.librarianUrl': '' })
  try {
    await withApp(
      async (_app, page) => {
        await page.getByRole('listitem', { name: PROJECT }).click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Open Terminal Here' }).click()
        const textarea = page.getByRole('tabpanel').getByTestId('terminal-pane').locator('textarea')
        await expect(textarea).toBeFocused()
        // Record the keys that reach the terminal on their way to the shell, rather than the shell's output.
        const pane = page.getByRole('tabpanel').getByTestId('terminal-pane')
        await pane.evaluate((element: KeyTarget) => {
          const modifiers = new Set(['Control', 'Meta', 'Shift', 'Alt'])
          element.dataset.keys = ''
          element.addEventListener(
            'keydown',
            (event) => {
              if (!modifiers.has(event.key)) element.dataset.keys += event.key
            },
            true
          )
        })
        await page.keyboard.press('ControlOrMeta+K')
        await expect(dialog(page)).toBeVisible()
        const input = dialog(page).getByRole('textbox', { name: 'Search memory' })
        await expect(input).toBeFocused()
        await expect(dialog(page)).toContainText(`What did your agents learn in ${PROJECT}?`)

        await page.keyboard.type('worktree decision')
        await expect(
          dialog(page).getByText(`Memory search isn't set up for ${PROJECT}`)
        ).toBeVisible()
        await saveScreenshot(page, 'memory-search-unconfigured')

        // Tab and Shift+Tab stay inside the popup.
        for (let step = 0; step < 8; step++) {
          await page.keyboard.press('Tab')
          await expect(dialog(page).locator(':focus')).toHaveCount(1)
        }
        for (let step = 0; step < 8; step++) {
          await page.keyboard.press('Shift+Tab')
          await expect(dialog(page).locator(':focus')).toHaveCount(1)
        }

        // Close Pane's key in the popup leaves the terminal behind it alone.
        await input.focus()
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+W' : 'Control+Shift+W')
        await expect(dialog(page)).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(dialog(page)).toBeHidden()
        await expect(textarea).toBeFocused()
        // Only the key pressed after the popup closed reached the terminal.
        await page.keyboard.press('x')
        await expect(pane).toHaveAttribute('data-keys', 'x')

        await page.getByRole('listitem', { name: PROJECT }).click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Search Memory…' }).click()
        await expect(dialog(page)).toBeVisible()
        // Keys typed before the field has focus would go nowhere.
        await expect(input).toBeFocused()
        await page.keyboard.type('anything')
        await dialog(page).getByRole('button', { name: 'Open Settings' }).click()
        await expect(dialog(page)).toBeHidden()
        await expect(page.getByRole('region', { name: 'Memory search' })).toBeVisible()
        await expect(page.getByRole('textbox', { name: 'Librarian MCP endpoint' })).toHaveValue('')
      },
      { userDataDir }
    )
  } finally {
    await cleanup()
  }
})

test('an unreachable Librarian shows the connection error in the popup', async () => {
  const port = await closedPort()
  const { userDataDir, cleanup } = await seed({
    'memory.librarianUrl': `http://127.0.0.1:${port}/_mcp`
  })
  try {
    await withApp(
      async (_app, page) => {
        await page.getByRole('button', { name: 'Search Memory', exact: true }).click()
        await expect(dialog(page)).toBeVisible()
        await page.keyboard.type('status server')
        const failure = dialog(page).getByRole('status')
        await expect(failure).toContainText('Search failed')
        await expect(failure).toContainText(
          `Librarian didn't answer: connection refused (127.0.0.1:${port}).`
        )
        await expect(failure.getByRole('button', { name: 'Try again' })).toBeVisible()
        await saveScreenshot(page, 'memory-search-unreachable')
        await page.keyboard.press('Escape')
        await expect(dialog(page)).toBeHidden()
      },
      { userDataDir }
    )
  } finally {
    await cleanup()
  }
})
