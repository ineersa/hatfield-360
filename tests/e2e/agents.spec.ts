import type { AgentSnapshot } from '../../src/shared/agent-api'
import type { DesktopApi } from '../../src/shared/desktop-api'
import { expect, test, type Locator, type Page, type Video } from '@playwright/test'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
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
  test.setTimeout(45_000)
  const { project, userDataDir, cleanup } = await seed()
  try {
    await withApp(
      async (_app, page) => {
        const treeTop = async () => (await projectRow(page).boundingBox())?.y
        await expect(projectRow(page)).toBeVisible()
        const originalTop = await treeTop()
        expect(originalTop).toBeDefined()
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
        await expect(hatfield).toContainText('Hatfield · Running')
        await expect(hatfield).not.toContainText(/unknown|unavailable|working|idle/i)
        const filter = page.getByRole('group', { name: 'Filter sessions by status' })
        await expect(
          filter.getByRole('button', {
            name: /unknown|unavailable|failed|cancelled|exited|completed/i
          })
        ).toHaveCount(0)
        expect(await treeTop()).toBe(originalTop)

        await startFocusedScenario(page, first)
        await expect(hatfield).toContainText('hatfield-e2e')
        await expect(hatfield).toContainText('Hatfield · Working')
        await command(page, first, 'tool')
        await expect(hatfield).toContainText('Working · Read')

        await first.click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Launch Claude in New Split' }).click()
        await expect(output(second)).toContainText('Scenario ready: split')
        await expect(output(second)).toContainText(`Directory: ${project}`)
        await expect(claude).toContainText('Claude · Running')
        await expect(hatfield).toContainText('Working · Read')
        await filter.getByRole('button', { name: 'Working', exact: true }).click()
        await expect(claude).toHaveCount(0)
        await filter.getByRole('button', { name: 'All', exact: true }).click()
        await expect(claude).toContainText('Claude · Running')
        await command(page, second, 'start')
        await expect(claude).toContainText('Claude · Working')
        await claude.click()
        await expect(second).toHaveClass(/is-active/)
        await expect(
          projectList.getByRole('button', { name: /^(Hatfield|Claude) session/ }).first()
        ).toHaveText(/Claude session/)
        const firstId = await first.getAttribute('data-terminal-id')
        if (!firstId) throw new Error('Hatfield terminal missing')
        const originalRow = await hatfield.elementHandle()
        const originalPane = await first.elementHandle()
        await page.evaluate((id) => globalThis.desktop.writeTerminal(id, 'wait\r'), firstId)
        await expect(hatfield).toContainText('Needs input: permission')
        await expect(attention.getByRole('button')).toHaveCount(1)
        expect(await treeTop()).toBe(originalTop)
        expect(await hatfield.evaluate((node, original) => node === original, originalRow)).toBe(
          true
        )
        expect(await first.evaluate((node, original) => node === original, originalPane)).toBe(true)
        await expect(first).toHaveAttribute('data-terminal-id', firstId)
        await originalRow.dispose()
        await originalPane.dispose()
        await expect(
          projectList.getByRole('button', { name: /^(Hatfield|Claude) session/ }).first()
        ).toHaveText(/Hatfield session/)
        await expect(second).toHaveClass(/is-active/)
        await command(page, second, 'wait')
        await expect(attention.getByRole('button')).toHaveCount(2)
        const attentionBounds = await attention.boundingBox()
        const lastWaitBounds = await attention.getByRole('button').last().boundingBox()
        if (!attentionBounds || !lastWaitBounds) throw new Error('Missing attention geometry')
        expect(lastWaitBounds.y + lastWaitBounds.height).toBeGreaterThan(
          attentionBounds.y + attentionBounds.height
        )
        expect(await treeTop()).toBe(originalTop)
        await command(page, second, 'resolve')
        await expect(attention.getByRole('button')).toHaveCount(1)
        await attention.getByRole('button', { name: /^Hatfield session/ }).click()
        await expect(first).toHaveClass(/is-active/)
        await expect(panes).toHaveCount(2)
        await filter.getByRole('button', { name: 'Needs input' }).click()
        await expect(claude).toHaveCount(0)
        await filter.getByRole('button', { name: 'Working', exact: true }).click()
        await expect(claude).toContainText('Working')
        await expect(hatfield).toContainText('Needs input: permission')
        await filter.getByRole('button', { name: 'All', exact: true }).click()
        await command(page, first, 'resolve')
        await expect(attention.getByRole('button')).toHaveCount(0)
        expect(await treeTop()).toBe(originalTop)
        await command(page, first, 'child')
        await command(page, first, 'completed')
        await expect(hatfield).toContainText('Needs input: question · Last turn: completed')
        await command(page, first, 'duplicate', 'duplicate')
        await command(page, first, 'stale', 'stale')
        await expect(attention.getByRole('button')).toHaveCount(1)
        await expect(hatfield).toContainText('Needs input: question · Last turn: completed')
        await command(page, first, 'child-done')
        await expect(hatfield).toContainText('Idle · Last turn: completed')
        await command(page, first, 'again')
        const rowHeight = (await hatfield.boundingBox())?.height
        expect(rowHeight).toBeDefined()
        await command(page, first, 'child-working')
        await command(page, first, 'script')
        await command(page, first, 'wait')
        await expect(hatfield).toContainText('1 agent running · 1 script running')
        expect((await hatfield.boundingBox())?.height).toBe(rowHeight)
        await filter.getByRole('button', { name: 'Working', exact: true }).click()
        await expect(hatfield).toContainText('Needs input: permission')
        await filter.getByRole('button', { name: 'Needs input' }).click()
        await expect(claude).toContainText('Working')
        await command(page, first, 'resolve')
        await command(page, first, 'completed')
        await expect(hatfield).toContainText('Working · Last turn: completed')
        await expect(hatfield).toHaveAttribute('aria-current', 'true')
        await filter.getByRole('button', { name: 'All', exact: true }).click()
        const idle = filter.getByRole('button', { name: 'Idle', exact: true })
        await idle.click()
        await expect(hatfield).toHaveCount(0)
        await filter.getByRole('button', { name: 'All', exact: true }).click()
        await command(page, first, 'child-done')
        await expect(hatfield).not.toContainText('agent running')
        await expect(hatfield).toContainText('1 script running')
        await idle.click()
        await expect(hatfield).toHaveCount(0)
        await command(page, first, 'script-done')
        await expect(hatfield).toContainText('Idle · Last turn: completed')
        expect((await hatfield.boundingBox())?.height).toBe(rowHeight)
        await filter.getByRole('button', { name: 'All', exact: true }).click()
        await command(page, first, 'again')
        await command(page, first, 'failed')
        await expect(hatfield).toContainText('Stopped · Last turn: failed')
        await command(page, second, 'cancelled')
        await expect(claude).toContainText('Stopped · Last turn: cancelled')
        await expect(hatfield).toContainText('Stopped · Last turn: failed')
        const stopped = filter.getByRole('button', { name: 'Stopped', exact: true })
        const all = filter.getByRole('button', { name: 'All', exact: true })
        await stopped.click()
        await expect(hatfield).toContainText('Stopped · Last turn: failed')
        await expect(claude).toContainText('Stopped · Last turn: cancelled')
        await all.click()
        await command(page, first, 'script')
        await expect(hatfield).toContainText('Working · Last turn: failed')
        await command(page, second, 'child')
        await expect(claude).toContainText('Needs input: question · Last turn: cancelled')
        await stopped.click()
        await expect(hatfield).toHaveCount(0)
        await expect(claude).toHaveCount(0)
        await all.click()
        await command(page, first, 'script-done')
        await expect(hatfield).toContainText('Stopped · Last turn: failed')
        await command(page, second, 'end-reporting')
        await expect(claude).toContainText('Running · Last turn: cancelled')
        await stopped.click()
        await expect(claude).toHaveCount(0)
        await all.click()
        await command(page, first, 'again')
        await command(page, first, 'wait')
        await first.click()
        await page.keyboard.type('quit')
        await page.keyboard.press('Enter')
        await expect(hatfield).toContainText('Hatfield · Stopped')
        await stopped.click()
        await expect(hatfield).toContainText('Hatfield · Stopped')
        await expect(claude).toHaveCount(0)
        await all.click()
        await idle.click()
        await expect(hatfield).toHaveCount(0)
        await all.click()
        await expect(attention.getByRole('button')).toHaveCount(0)
        await expect(claude).toContainText('Running · Last turn: cancelled')
      },
      { userDataDir }
    )
  } finally {
    await cleanup()
  }
})

test('records the event-only agent status demonstration', async () => {
  test.skip(!demo, 'Opt-in recording')
  test.skip(process.platform === 'win32', 'The agent reporting transport is Unix only')
  test.setTimeout(90_000)
  const { userDataDir, cleanup } = await seed()
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
          await expect(output(first)).toContainText('Scenario ready:')
          await first.click({ button: 'right' })
          await page.getByRole('menuitem', { name: 'Launch Claude in New Split' }).click()
          await expect(output(second)).toContainText('Scenario ready: split')
          const firstId = await first.getAttribute('data-terminal-id')
          const secondId = await second.getAttribute('data-terminal-id')
          if (!firstId || !secondId) throw new Error('Demo terminals missing')
          const tree = page.getByRole('list', { name: 'Workspace folders' })
          const hatfield = tree.getByRole('button', { name: /^Hatfield session/ })
          const claude = tree.getByRole('button', { name: /^Claude session/ })
          async function step(pane: Locator, id: string, text: string) {
            await page.evaluate(
              ({ terminalId, input }) => globalThis.desktop.writeTerminal(terminalId, input),
              { terminalId: id, input: `${text}\r` }
            )
            await expect(output(pane)).toContainText(`ACK ${text}: accepted`)
          }
          await step(first, firstId, 'start')
          await step(second, secondId, 'start')
          await expect(hatfield).toContainText('Working')
          await expect(claude).toContainText('Working')
          await capture(page, '01-working')
          await step(first, firstId, 'wait')
          await expect(hatfield).toContainText('Needs input: permission')
          await capture(page, '02-permission')
          await step(first, firstId, 'resolve')
          await step(second, secondId, 'child')
          await expect(claude).toContainText('Needs input: question')
          await capture(page, '03-question')
          await step(second, secondId, 'child-done')
          await step(first, firstId, 'child-working')
          await step(first, firstId, 'script')
          await step(first, firstId, 'completed')
          await expect(hatfield).toContainText('Working · Last turn: completed')
          await expect(hatfield).toContainText('1 agent running · 1 script running')
          await capture(page, '04-background')
          await step(first, firstId, 'child-done')
          await step(first, firstId, 'script-done')
          await expect(hatfield).toContainText('Idle · Last turn: completed')
          await capture(page, '05-idle')
          await step(first, firstId, 'again')
          await step(first, firstId, 'failed')
          await step(second, secondId, 'cancelled')
          await expect(hatfield).toContainText('Stopped · Last turn: failed')
          await expect(claude).toContainText('Stopped · Last turn: cancelled')
          await expect(second).toHaveClass(/is-active/)
          await capture(page, '06-outcomes')
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

test('agent notifications follow accepted transitions and open only the owning terminal', async () => {
  test.skip(process.platform === 'win32', 'The agent reporting transport is Unix only')
  const { userDataDir, cleanup } = await seed()
  try {
    await withApp(
      async (_app, page) => {
        await launch(page, 'Hatfield')
        const hatfield = page
          .getByRole('tabpanel', { name: 'Hatfield' })
          .getByTestId('terminal-pane')
        await startFocusedScenario(page, hatfield)
        await command(page, hatfield, 'tool')
        const bell = page.getByRole('button', { name: /^Notifications(?: \(\d+\))?$/ })
        await expect(bell).toHaveAccessibleName('Notifications')
        await command(page, hatfield, 'wait')
        await expect(page.getByRole('alert', { name: 'Agent needs input' })).toBeVisible()
        await bell.click()
        const panel = page.getByRole('complementary', { name: 'Notifications panel' })
        const history = panel.getByRole('listitem')
        const needsInput = panel.getByRole('listitem', { name: 'Agent needs input' })
        const completed = panel.getByRole('listitem', { name: 'Agent turn completed' })
        await command(page, hatfield, 'duplicate', 'duplicate')
        await command(page, hatfield, 'stale', 'stale')
        await command(page, hatfield, 'child')
        await command(page, hatfield, 'resolve')
        await expect(needsInput).toHaveCount(1)
        await command(page, hatfield, 'child-done')
        const hatfieldId = await hatfield.getAttribute('data-terminal-id')
        if (!hatfieldId) throw new Error('Hatfield terminal missing')
        const send = (input: string) =>
          page.evaluate(({ id, text }) => globalThis.desktop.writeTerminal(id, `${text}\r`), {
            id: hatfieldId,
            text: input
          })
        await send('child')
        await expect(needsInput).toHaveCount(2)
        await command(page, hatfield, 'script')
        await command(page, hatfield, 'completed')
        await expect(completed).toHaveCount(0)
        await send('child-done')
        await expect(page.getByRole('button', { name: /^Hatfield session/ })).not.toContainText(
          'Needs input'
        )
        await expect(completed).toHaveCount(0)
        await command(page, hatfield, 'child-working')
        await command(page, hatfield, 'script-done')
        await expect(completed).toHaveCount(0)
        await send('child-done')
        await expect(completed).toHaveCount(1)
        await command(page, hatfield, 'again')
        await command(page, hatfield, 'failed')
        await expect(panel.getByRole('listitem', { name: 'Agent turn failed' })).toHaveCount(1)

        await launch(page, 'Claude')
        const claude = page.getByRole('tabpanel', { name: 'Claude' }).getByTestId('terminal-pane')
        await startFocusedScenario(page, claude)
        await command(page, claude, 'cancelled')
        await expect(history).toHaveCount(4)
        await expect(page.getByRole('tab', { name: 'Claude', selected: true })).toBeVisible()
        const beforeMessage = await page.evaluate(() => globalThis.desktop.getAgentSessions())
        const openSettings = page.getByRole('button', { name: 'Settings', exact: true })
        const settings = page.getByRole('main', { name: 'Settings', exact: true })
        await openSettings.click()
        await send('message')
        const message = panel.getByRole('listitem', { name: 'Review available' })
        await expect(message).toContainText('Hatfield · hatfield-e2e')
        await expect(message).toContainText('The report is ready.')
        await expect(settings).toBeVisible()
        expect(await page.evaluate(() => globalThis.desktop.getAgentSessions())).toEqual(
          beforeMessage
        )
        await send('duplicate')
        await message.getByRole('button', { name: 'Open terminal' }).click()
        await expect(settings).toHaveCount(0)
        await expect(page.getByRole('tab', { name: 'Hatfield', selected: true })).toBeVisible()
        await expect(hatfield.locator('textarea')).toBeFocused()
        await expect(output(hatfield)).toContainText(
          /ACK message: accepted.*ACK duplicate: duplicate/s
        )
        await expect(message).toHaveCount(1)
        await page.getByRole('button', { name: 'Close Hatfield', exact: true }).click()
        await openSettings.click()
        await message.getByRole('button', { name: 'Open terminal' }).click()
        await expect(
          panel.getByRole('listitem', { name: 'Terminal no longer available' })
        ).toBeVisible()
        await expect(settings).toBeVisible()
        await expect(page.getByRole('tab', { name: 'Hatfield', includeHidden: true })).toHaveCount(
          0
        )
        await expect(panel.getByRole('listitem', { name: 'Agent turn failed' })).toHaveCount(1)
      },
      { userDataDir }
    )
  } finally {
    await cleanup()
  }
})

test('an announced child blocks completion before reporting its first turn', async () => {
  test.skip(process.platform === 'win32', 'The agent reporting transport is Unix only')
  const { userDataDir, cleanup } = await seed()
  try {
    await withApp(
      async (_app, page) => {
        await launch(page, 'Hatfield')
        const pane = page.getByRole('tabpanel', { name: 'Hatfield' }).getByTestId('terminal-pane')
        await startFocusedScenario(page, pane)
        await page.getByRole('button', { name: 'Notifications', exact: true }).click()
        const panel = page.getByRole('complementary', { name: 'Notifications panel' })
        const completion = panel.getByRole('listitem', { name: 'Agent turn completed' })
        await command(page, pane, 'child-start-only')
        await command(page, pane, 'completed')
        await expect(page.getByRole('button', { name: /^Hatfield session/ })).toContainText(
          'Last turn: completed'
        )
        await expect(completion).toHaveCount(0)
        await command(page, pane, 'child-done')
        await expect(completion).toHaveCount(1)
        await command(page, pane, 'duplicate', 'duplicate')
        await expect(completion).toHaveCount(1)
      },
      { userDataDir }
    )
  } finally {
    await cleanup()
  }
})

test('closing an agent terminal suppresses a real hangup failure report', async () => {
  test.skip(process.platform === 'win32', 'The agent reporting transport is Unix only')
  const { project, userDataDir, cleanup } = await seed()
  try {
    await withApp(
      async (_app, page) => {
        await launch(page, 'Hatfield')
        const pane = page.getByRole('tabpanel', { name: 'Hatfield' }).getByTestId('terminal-pane')
        await startFocusedScenario(page, pane)
        await command(page, pane, 'report-failure-on-hangup', 'armed')
        await page.getByRole('button', { name: 'Notifications', exact: true }).click()
        const panel = page.getByRole('complementary', { name: 'Notifications panel' })
        await page.getByRole('button', { name: 'Close Hatfield', exact: true }).click()
        await expect
          .poll(() => readFile(join(project, 'hangup-report'), 'utf8').catch(() => null))
          .toBe('accepted')
        await expect(page.getByRole('button', { name: /^Hatfield session/ })).toContainText(
          'Stopped · Last turn: failed'
        )
        await expect
          .poll(() =>
            page.evaluate(async () =>
              (await globalThis.desktop.getAgentSessions()).sessions.map(
                ({ process, outcome }) => ({ process, outcome })
              )
            )
          )
          .toEqual([{ process: 'exited', outcome: 'failed' }])
        await expect(panel.getByText('No notifications.', { exact: true })).toBeVisible()
      },
      { userDataDir }
    )
  } finally {
    await cleanup()
  }
})

test('a newer main turn supersedes a pending agent completion', async () => {
  test.skip(process.platform === 'win32', 'The agent reporting transport is Unix only')
  const { userDataDir, cleanup } = await seed()
  try {
    await withApp(
      async (_app, page) => {
        await launch(page, 'Hatfield')
        const pane = page.getByRole('tabpanel', { name: 'Hatfield' }).getByTestId('terminal-pane')
        await startFocusedScenario(page, pane)
        await page.getByRole('button', { name: 'Notifications', exact: true }).click()
        const panel = page.getByRole('complementary', { name: 'Notifications panel' })
        const completed = panel.getByRole('listitem', { name: 'Agent turn completed' })
        await command(page, pane, 'script')
        await command(page, pane, 'completed')
        await expect(completed).toHaveCount(0)
        await command(page, pane, 'again')
        await command(page, pane, 'cancelled')
        await command(page, pane, 'script-done')
        await expect(completed).toHaveCount(0)
        await command(page, pane, 'again')
        await command(page, pane, 'completed')
        await expect(completed).toHaveCount(1)
      },
      { userDataDir }
    )
  } finally {
    await cleanup()
  }
})

test('a project with broken Git metadata still displays its launched session', async () => {
  test.skip(process.platform === 'win32', 'The agent reporting transport is Unix only')
  const { project, userDataDir, cleanup } = await seed()
  try {
    await mkdir(join(project, '.git'))
    await withApp(
      async (_app, page) => {
        const folders = page.getByRole('list', { name: 'Workspace folders' })
        const gitError = folders.getByRole('alert').filter({ hasText: 'Git:' })
        await expect(gitError).toBeVisible()
        await launch(page, 'Hatfield')
        const pane = page.getByRole('tabpanel', { name: 'Hatfield' }).getByTestId('terminal-pane')
        await startFocusedScenario(page, pane)
        const session = folders.getByRole('button', { name: /^Hatfield session/ })
        await expect(session).toHaveCount(1)
        await expect(session).toContainText('hatfield-e2e')
        await expect(gitError).toBeVisible()
        await projectRow(page).getByRole('button', { name: 'Collapse agent-project' }).click()
        await expect(session).toHaveCount(0)
        await expect(gitError).toHaveCount(0)
      },
      { userDataDir }
    )
  } finally {
    await cleanup()
  }
})

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
            const settings = page.getByRole('main', { name: 'Settings', exact: true })
            const openSettings = page.getByRole('button', { name: 'Settings', exact: true })
            const agentsView = page.getByRole('button', { name: 'Agents', exact: true })
            await openSettings.click()
            await expect(settings).toBeVisible()
            await page.getByRole('button', { name: /^Hatfield session/ }).click()
            await expect(settings).toHaveCount(0)
            await expect(agentsView).toHaveAttribute('aria-pressed', 'true')
            await expect(rootPane).toBeVisible()
            await expect(rootPane.locator('textarea')).toBeFocused()
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
            await openSettings.click()
            await expect(settings).toBeVisible()
            await attention.click()
            await expect(settings).toHaveCount(0)
            await expect(agentsView).toHaveAttribute('aria-pressed', 'true')
            await expect(worktreePane).toBeVisible()
            await expect(worktreePane.locator('textarea')).toBeFocused()
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

            await rename(join(repo, '.git'), join(repo, 'git-backup'))
            await mkdir(join(repo, '.git'))
            const folders = page.getByRole('list', { name: 'Workspace folders' })
            await expect(folders.getByRole('alert').filter({ hasText: 'Git:' })).toBeVisible()
            await expect(folders.getByRole('listitem', { name: 'feature worktree' })).toHaveCount(0)
            const linkedSession = folders.getByRole('button', { name: /^Claude session/ })
            await expect(linkedSession).toHaveCount(1)
            await expect(linkedSession).toContainText('claude-e2e')
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
