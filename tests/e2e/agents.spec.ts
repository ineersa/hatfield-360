import type { AgentSnapshot } from '../../src/shared/agent-api'
import type { DesktopApi } from '../../src/shared/desktop-api'
import { expect, test, type Locator, type Page, type Video } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { git, makeRepo } from './git-repository'
import { makeTempDir, saveScreenshot, withApp } from './launch-app'

declare global {
  var desktop: DesktopApi
  var innerWidth: number
  var innerHeight: number
}

const fixture = resolve(__dirname, 'fixtures/agent-scenario.mjs')
const demoSize = { width: 1600, height: 1000 }
const demo = process.env.E2E_AGENT_DEMO === '1'
const artifacts = resolve(__dirname, '../../test-results/agents-demo')
const output = (pane: Locator) => pane.locator('.xterm-rows')
const projectRow = (page: Page) =>
  page.getByRole('listitem', { name: 'agent-project', exact: true })

async function seed(repo?: string) {
  const [dir, cleanup] = await makeTempDir('agents')
  const project = repo ?? join(dir, 'agent-project')
  const userDataDir = join(dir, 'user-data')
  if (!repo) await mkdir(project)
  const otherProject = join(dir, 'side-project')
  await mkdir(otherProject)
  await mkdir(join(userDataDir, 'workspaces'), { recursive: true })
  await writeFile(
    join(userDataDir, 'workspaces/default.hatfield-workspace'),
    JSON.stringify({ version: 1, folders: [{ path: project }, { path: otherProject }] })
  )
  await writeFile(
    join(userDataDir, 'settings.json'),
    JSON.stringify({
      'terminal.gpuAcceleration': false,
      'agents.hatfield': {
        executable: process.execPath,
        args: [fixture, 'hatfield', 'hatfield-e2e', 'literal $HOME; *']
      },
      'agents.claude': {
        executable: process.execPath,
        args: [fixture, 'claude', 'claude-e2e', 'split']
      }
    })
  )
  return { project, userDataDir, cleanup }
}

async function command(page: Page, pane: Locator, text: string, reply = 'accepted') {
  await pane.click()
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
  await expect(output(pane)).toContainText(`ACK ${text}: ${reply}`)
}

async function startFocusedScenario(page: Page, pane: Locator) {
  await expect(pane.locator('textarea')).toBeFocused()
  await page.keyboard.type('start')
  await page.keyboard.press('Enter')
  await expect(output(pane)).toContainText('ACK start: accepted')
}

async function launch(page: Page, provider: string) {
  await projectRow(page).click({ button: 'right' })
  await page.getByRole('menuitem', { name: `Launch ${provider}`, exact: true }).click()
}

async function capture(page: Page, name: string) {
  if (!demo) return
  await saveScreenshot(page, `agents-demo/${name}`)
  await delay(1_650)
}

test('agent launches report through the real socket and sidebar rows select exact panes', async () => {
  test.skip(process.platform === 'win32', 'The agent reporting transport is Unix only')
  test.setTimeout(demo ? 90_000 : 45_000)
  const { project, userDataDir, cleanup } = await seed()
  const videos: Video[] = []
  try {
    if (demo) {
      await mkdir(artifacts, { recursive: true })
      await writeFile(
        join(userDataDir, 'window-state.json'),
        JSON.stringify({
          version: 1,
          window: { x: 0, y: 0, ...demoSize, maximized: false },
          layout: {
            activeView: 'agents',
            panels: {
              agents: { width: 380, collapsed: false },
              files: { width: 300, collapsed: false },
              git: { width: 300, collapsed: false }
            }
          }
        })
      )
    }
    await withApp(
      async (app, page) => {
        const video = page.video()
        if (video) videos.push(video)
        if (demo) {
          expect(video, 'Electron window must support Playwright video').not.toBeNull()
          const rendererSize = () =>
            page.evaluate(() => ({ width: globalThis.innerWidth, height: globalThis.innerHeight }))
          const nativeSize = (request?: typeof demoSize) =>
            app.evaluate(({ BrowserWindow }, size) => {
              const window = BrowserWindow.getAllWindows()[0]
              if (!window) throw new Error('Demo window missing')
              const [width, height] = window.getContentSize()
              if (size && (width !== size.width || height !== size.height))
                window.setContentSize(size.width, size.height)
              const [observedWidth, observedHeight] = window.getContentSize()
              if (observedWidth === undefined || observedHeight === undefined)
                throw new Error('Demo window content size missing')
              return { width: observedWidth, height: observedHeight }
            }, request)
          await nativeSize(demoSize)
          await expect
            .poll(async () => {
              const viewport = await rendererSize()
              const native = await nativeSize()
              return viewport.width === native.width && viewport.height === native.height
            })
            .toBe(true)
          const observed = await nativeSize()
          if (observed.width !== demoSize.width || observed.height !== demoSize.height) {
            // Fractional display scaling can round the requested size in either direction.
            await nativeSize({
              width: demoSize.width + (demoSize.width - observed.width),
              height: demoSize.height + (demoSize.height - observed.height)
            })
          }
          await expect.poll(rendererSize).toEqual(demoSize)
          await expect.poll(() => nativeSize()).toEqual(demoSize)
          await page.context().tracing.start({ screenshots: true, snapshots: true })
        }
        try {
          await launch(page, 'Hatfield')
          const panes = page.getByTestId('terminal-pane')
          const first = panes.first()
          const second = panes.nth(1)
          const projectList = page.getByRole('list', { name: 'Workspace folders' })
          const hatfield = projectList.getByRole('button', { name: /^Hatfield session/ })
          const claude = projectList.getByRole('button', { name: /^Claude session/ })
          const attention = page.getByRole('list', { name: 'Sessions needing input' })
          await expect(output(first)).toContainText('Scenario ready: literal $HOME; *')
          await expect(output(first)).toContainText(`Directory: ${project}`)
          await expect(hatfield).toContainText('Running · status unavailable')

          await startFocusedScenario(page, first)
          await expect(hatfield).toContainText('hatfield-e2e')
          await expect(hatfield).toContainText('Hatfield · Working')
          await command(page, first, 'tool')
          await expect(hatfield).toContainText('Working · Read')
          await capture(page, '01-working')

          await first.click({ button: 'right' })
          await page.getByRole('menuitem', { name: 'Launch Claude in New Split' }).click()
          await expect(output(second)).toContainText('Scenario ready: split')
          await expect(output(second)).toContainText(`Directory: ${project}`)
          await expect(claude).toContainText('Running · status unavailable')
          await expect(hatfield).toContainText('Working · Read')
          await command(page, second, 'start')
          await expect(claude).toContainText('Claude · Working')
          await claude.click()
          await expect(second).toHaveClass(/is-active/)
          await expect(
            projectList.getByRole('button', { name: /^(Hatfield|Claude) session/ }).first()
          ).toHaveText(/Claude session/)
          const firstId = await first.getAttribute('data-terminal-id')
          if (!firstId) throw new Error('Hatfield terminal missing')
          await page.evaluate((id) => globalThis.desktop.writeTerminal(id, 'wait\r'), firstId)
          await expect(hatfield).toContainText('Needs input: permission')
          await expect(attention.getByRole('button')).toHaveCount(1)
          await expect(
            projectList.getByRole('button', { name: /^(Hatfield|Claude) session/ }).first()
          ).toHaveText(/Hatfield session/)
          await expect(second).toHaveClass(/is-active/)
          await attention.getByRole('button', { name: /^Hatfield session/ }).click()
          await expect(first).toHaveClass(/is-active/)
          await expect(panes).toHaveCount(2)
          await capture(page, '02-needs-input')
          const filter = page.getByRole('group', { name: 'Filter sessions by status' })
          await filter.getByRole('button', { name: 'Needs input' }).click()
          await expect(claude).toHaveCount(0)
          await filter.getByRole('button', { name: 'Working', exact: true }).click()
          await expect(claude).toContainText('Working')
          await expect(hatfield).toContainText('Needs input: permission')
          await filter.getByRole('button', { name: 'All', exact: true }).click()
          await command(page, first, 'resolve')
          await expect(attention).toHaveCount(0)
          await command(page, first, 'child')
          await command(page, first, 'completed')
          await expect(hatfield).toContainText('Needs input: question · Last turn: completed')
          await capture(page, '03-question')
          await command(page, first, 'duplicate', 'duplicate')
          await command(page, first, 'stale', 'stale')
          await expect(attention.getByRole('button')).toHaveCount(1)
          await expect(hatfield).toContainText('Needs input: question · Last turn: completed')
          await command(page, first, 'child-done')
          await expect(hatfield).toContainText('Idle · Completed')
          await command(page, first, 'again')
          await command(page, first, 'child-working')
          await command(page, first, 'script')
          await command(page, first, 'wait')
          await expect(hatfield).toContainText('1 agent running · 1 script running')
          await filter.getByRole('button', { name: 'Working', exact: true }).click()
          await expect(hatfield).toContainText('Needs input: permission')
          await filter.getByRole('button', { name: 'Needs input' }).click()
          await expect(claude).toContainText('Working')
          await command(page, first, 'resolve')
          await command(page, first, 'completed')
          await expect(hatfield).toContainText('Working · Last turn: completed')
          await expect(hatfield).toHaveAttribute('aria-current', 'true')
          await capture(page, '04-background')
          await filter.getByRole('button', { name: 'All', exact: true }).click()
          const completed = filter.getByRole('button', { name: 'Completed', exact: true })
          await completed.click()
          await expect(hatfield).toHaveCount(0)
          await filter.getByRole('button', { name: 'All', exact: true }).click()
          await command(page, first, 'child-done')
          await expect(hatfield).not.toContainText('agent running')
          await expect(hatfield).toContainText('1 script running')
          await completed.click()
          await expect(hatfield).toHaveCount(0)
          await command(page, first, 'script-done')
          await expect(hatfield).toContainText('Idle · Completed')
          await filter.getByRole('button', { name: 'All', exact: true }).click()
          await capture(page, '05-completed')
          await command(page, first, 'again')
          await command(page, first, 'failed')
          await expect(hatfield).toContainText('Idle · Failed')
          await command(page, second, 'cancelled')
          await expect(claude).toContainText('Idle · Cancelled')
          await expect(hatfield).toContainText('Idle · Failed')
          await capture(page, '06-outcomes')
          await command(page, first, 'again')
          await command(page, first, 'wait')
          await first.click()
          await page.keyboard.type('quit')
          await page.keyboard.press('Enter')
          await expect(hatfield).toContainText('Exited')
          await expect(attention).toHaveCount(0)
          await expect(claude).toContainText('Idle · Cancelled')
        } finally {
          if (demo) await page.context().tracing.stop({ path: join(artifacts, 'trace.zip') })
        }
      },
      {
        userDataDir,
        ...(demo ? { recordVideo: { dir: artifacts, size: demoSize } } : {})
      }
    )
    const recorded = videos[0]
    if (demo && recorded) await recorded.saveAs(join(artifacts, 'agent-sessions.webm'))
  } finally {
    await cleanup()
  }
})

test('agent launch settings are validated and a missing executable does not create a session', async () => {
  const { userDataDir, cleanup } = await seed()
  const missing = join(userDataDir, 'missing-agent-command')
  try {
    await withApp(
      async (_app, page) => {
        await page.getByRole('button', { name: 'Settings', exact: true }).click()
        await page.getByRole('textbox', { name: 'Hatfield executable' }).fill(missing)
        const args = page.getByRole('textbox', { name: 'Hatfield arguments (JSON array)' })
        await args.fill('[23]')
        await page.getByRole('button', { name: 'Save Hatfield profile' }).click()
        await expect(
          page.getByRole('alert').filter({ hasText: 'Arguments must be a JSON array of strings' })
        ).toBeVisible()
        await expect(
          page.evaluate(() =>
            globalThis.desktop.updateSetting('agents.hatfield', { executable: '\0bad', args: [] })
          )
        ).rejects.toThrow('must contain an executable')
        await args.fill('[]')
        await page.getByRole('button', { name: 'Save Hatfield profile' }).click()
        await expect
          .poll(
            async () =>
              JSON.parse(await readFile(join(userDataDir, 'settings.json'), 'utf8')) as unknown
          )
          .toMatchObject({ 'agents.hatfield': { executable: missing, args: [] } })
        await page.getByRole('button', { name: 'Close Settings' }).click()
        await expect(
          page.evaluate(() =>
            globalThis.desktop.launchAgent({
              provider: 'hatfield',
              target: { project: '/not-in-workspace', cwd: '/not-in-workspace' },
              cols: 80,
              rows: 24
            })
          )
        ).rejects.toThrow('Choose a project in the current workspace')
        await launch(page, 'Hatfield')
        await expect(output(page.getByTestId('terminal-pane'))).toContainText(
          "The agent couldn't start"
        )
        await expect(page.getByRole('button', { name: /^Hatfield session/ })).toHaveCount(0)
      },
      { userDataDir }
    )
  } finally {
    await cleanup()
  }
})

function expectPublicSnapshot(snapshot: AgentSnapshot): void {
  // An exact allowlist catches extra private fields even when nested on a session.
  expect(Object.keys(snapshot).toSorted()).toEqual(['revision', 'sessions'])
  for (const session of snapshot.sessions) {
    expect(Object.keys(session).toSorted()).toEqual([
      'activity',
      'cwd',
      'id',
      'outcome',
      'process',
      'project',
      'provider',
      'providerSessionId',
      'runningChildren',
      'runningScripts',
      'terminalId',
      'tool',
      'updatedAt',
      'wait'
    ])
  }
}

test('a linked worktree launches into its own tab and publishes only public session data', async () => {
  test.skip(process.platform === 'win32', 'The agent reporting transport is Unix only')
  const { repo, projects, cleanup: cleanRepo } = await makeRepo()
  try {
    const worktree = join(projects, 'app-feature')
    git(repo, 'worktree', 'add', '-q', '-b', 'feature', worktree)
    const { userDataDir, cleanup } = await seed(repo)
    try {
      const settingsFile = join(userDataDir, 'settings.json')
      const beforeSettings = await readFile(settingsFile, 'utf8')
      await withApp(
        async (_app, page) => {
          const reports = await page.evaluateHandle(() => {
            const updates: AgentSnapshot[] = []
            const stop = globalThis.desktop.subscribeAgentSessions((snapshot) =>
              updates.push(snapshot)
            )
            return { updates, stop }
          })
          try {
            const project = page.getByRole('listitem', { name: 'app', exact: true })
            await project.click({ button: 'right' })
            await page.getByRole('menuitem', { name: 'Launch Hatfield', exact: true }).click()
            const rootPane = page
              .getByRole('tabpanel', { name: 'Hatfield' })
              .getByTestId('terminal-pane')
            await expect(output(rootPane)).toContainText(`Directory: ${repo}`)
            await startFocusedScenario(page, rootPane)

            await page
              .getByRole('listitem', { name: 'feature worktree' })
              .click({ button: 'right' })
            await page.getByRole('menuitem', { name: 'Launch Claude', exact: true }).click()
            const worktreePane = page
              .getByRole('tabpanel', { name: 'Claude' })
              .getByTestId('terminal-pane')
            await expect(output(worktreePane)).toContainText(`Directory: ${worktree}`)
            await startFocusedScenario(page, worktreePane)
            const worktreeId = await worktreePane.getAttribute('data-terminal-id')
            if (!worktreeId) throw new Error('Linked worktree terminal missing')
            await page.getByRole('button', { name: /^Hatfield session/ }).click()
            await expect(page.getByRole('tab', { name: 'Hatfield', selected: true })).toBeVisible()
            await page.evaluate((id) => globalThis.desktop.writeTerminal(id, 'wait\r'), worktreeId)
            const attention = page
              .getByRole('list', { name: 'Sessions needing input' })
              .getByRole('button', { name: /^Claude session/ })
            await expect(attention).toContainText('Needs input: permission')
            const scope = page.getByRole('combobox', { name: 'Filter by project' })
            await scope.selectOption({ label: 'side-project' })
            await expect(attention).toHaveCount(0)
            await expect(page.getByText('No sessions match this filter.')).toBeVisible()
            await expect(page.getByRole('tab', { name: 'Hatfield', selected: true })).toBeVisible()
            await scope.selectOption({ label: 'All projects' })
            await expect(attention).toBeVisible()
            await expect(page.getByRole('tab', { name: 'Hatfield', selected: true })).toBeVisible()
            await expect(rootPane).toHaveClass(/is-active/)
            await attention.click()
            await expect(page.getByRole('tab', { name: 'Claude', selected: true })).toBeVisible()
            await expect(worktreePane).toHaveAttribute('data-terminal-id', worktreeId)
            await expect(output(worktreePane)).toContainText('ACK wait: accepted')

            const expected = {
              provider: 'claude',
              providerSessionId: 'claude-e2e',
              project: repo,
              cwd: worktree,
              wait: 'permission',
              terminalId: worktreeId
            }
            const snapshot = await page.evaluate(() => globalThis.desktop.getAgentSessions())
            expect(snapshot.sessions).toHaveLength(2)
            expect(snapshot.sessions).toContainEqual(expect.objectContaining(expected))
            expectPublicSnapshot(snapshot)
            const pushed = await reports.evaluate(({ updates }) => updates)
            expect(pushed).toContainEqual(snapshot)
            for (const update of pushed) expectPublicSnapshot(update)
          } finally {
            await reports.evaluate(({ stop }) => stop())
            await reports.dispose()
          }
        },
        { userDataDir }
      )
      expect(await readFile(settingsFile, 'utf8')).toBe(beforeSettings)
    } finally {
      await cleanup()
    }
  } finally {
    await cleanRepo()
  }
})
