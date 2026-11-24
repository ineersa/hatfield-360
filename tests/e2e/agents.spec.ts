import type { AgentSnapshot } from '../../src/shared/agent-api'
import type { DesktopApi } from '../../src/shared/desktop-api'
import { expect, test, type Locator, type Page, type Video } from '@playwright/test'
import { mkdir, readFile, rename, rm, rmdir, symlink, writeFile } from 'node:fs/promises'
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
        args: [fixture, 'claude', 'a3f91c2d-3691-4c2f-b54f-e4db8704bbc1', 'split']
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
  test.setTimeout(45_000)
  const { project, userDataDir, cleanup } = await seed()
  try {
    await withApp(
      async (_app, page) => {
        const treeTop = async () => (await projectRow(page).boundingBox())?.y
        await expect(projectRow(page)).toBeVisible()
        const originalTop = await treeTop()
        if (originalTop === undefined) throw new Error('Project row not on screen')
        await launch(page, 'Hatfield')
        const panes = page.getByTestId('terminal-pane')
        const first = panes.first()
        const second = panes.nth(1)
        const projectList = page.getByRole('list', { name: 'Workspace folders' })
        const hatfield = projectList.getByRole('button', { name: /^Hatfield (?:#|·)/ })
        const claude = projectList.getByRole('button', { name: /^Claude / })
        const orderedRows = projectList.getByRole('button', {
          name: /^(?:Hatfield (?:#|·)|Claude )/
        })
        const expectLaunchOrder = () =>
          expect(orderedRows).toHaveText([/^a3f91c2d|^Triage/, /^#hatfield-e2e/])
        await expect(output(first)).toContainText('Scenario ready: literal $HOME; *')
        await expect(output(first)).toContainText(`Directory: ${project}`)
        await expect(hatfield).toContainText('Running')
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
        await expect(hatfield).toContainText('Working')
        await command(page, first, 'tool')
        await expect(hatfield).toHaveAttribute('aria-description', /Working · Read/)

        await first.click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Launch Claude in New Split' }).click()
        await expect(output(second)).toContainText('Scenario ready: split')
        await expect(output(second)).toContainText(`Directory: ${project}`)
        await expect(claude).toContainText('Running')
        await expect(hatfield).toHaveAttribute('aria-description', /Working · Read/)
        await filter.getByRole('button', { name: 'Working', exact: true }).click()
        await expect(claude).toHaveCount(0)
        await filter.getByRole('button', { name: 'All', exact: true }).click()
        await expect(claude).toContainText('Running')
        await command(page, second, 'start')
        await expect(claude).toHaveText('a3f91c2dWorking')
        await command(page, first, 'title')
        await expect(hatfield).toHaveText('#hatfield-e2e — Review <draft>Working')
        await expect(hatfield).toHaveAttribute(
          'aria-description',
          /Hatfield #hatfield-e2e · Review <draft>/
        )
        await expectLaunchOrder()
        await command(page, second, 'title')
        await expect(claude).toHaveText('Triage <draft>Working')
        await expect(claude).toHaveAttribute(
          'aria-description',
          /Claude a3f91c2d-3691-4c2f-b54f-e4db8704bbc1 · Triage <draft>/
        )
        await claude.click()
        await expect(second).toHaveClass(/is-active/)
        await expect(
          projectList.getByRole('button', { name: /^(?:Hatfield (?:#|·)|Claude )/ }).first()
        ).toHaveAccessibleName(
          'Claude a3f91c2d-3691-4c2f-b54f-e4db8704bbc1 · Triage <draft> · Working'
        )
        const firstId = await first.getAttribute('data-terminal-id')
        if (!firstId) throw new Error('Hatfield terminal missing')
        const originalRow = await hatfield.elementHandle()
        const originalPane = await first.elementHandle()
        await page.evaluate((id) => globalThis.desktop.writeTerminal(id, 'wait\r'), firstId)
        await expect(hatfield).toHaveAttribute('aria-description', /Needs input: permission/)
        await expect(
          projectList
            .getByRole('button', { name: /^(?:Hatfield #|Claude [a-f0-9])/ })
            .filter({ hasText: 'Needs input' })
        ).toHaveCount(1)
        expect(await treeTop()).toBeGreaterThan(originalTop)
        expect(await hatfield.evaluate((node, original) => node === original, originalRow)).toBe(
          true
        )
        expect(await first.evaluate((node, original) => node === original, originalPane)).toBe(true)
        await expect(first).toHaveAttribute('data-terminal-id', firstId)
        await originalRow.dispose()
        await originalPane.dispose()
        await expect(
          projectList.getByRole('button', { name: /^(?:Hatfield (?:#|·)|Claude )/ }).first()
        ).toHaveAccessibleName(
          'Claude a3f91c2d-3691-4c2f-b54f-e4db8704bbc1 · Triage <draft> · Working'
        )
        await expect(second).toHaveClass(/is-active/)
        await command(page, second, 'wait')
        await expect(
          projectList
            .getByRole('button', { name: /^(?:Hatfield #|Claude [a-f0-9])/ })
            .filter({ hasText: 'Needs input' })
        ).toHaveCount(2)
        expect(await treeTop()).toBeGreaterThan(originalTop)
        const attentionActions = page
          .getByRole('region', { name: 'Agents needing attention' })
          .getByRole('button', { name: /^Open terminal for/ })
        await expect(attentionActions).toHaveCount(2)
        await expect(attentionActions.first()).toHaveAccessibleName(
          'Open terminal for Triage <draft>'
        )
        await command(page, first, 'tool')
        await expect(hatfield).toHaveAttribute('aria-description', /Needs input: permission/)
        await command(page, first, 'reselect')
        await expectLaunchOrder()
        await expect(attentionActions.first()).toHaveAccessibleName(
          'Open terminal for Triage <draft>'
        )
        await command(page, second, 'reselect')
        await expectLaunchOrder()
        await command(page, second, 'resolve')
        await expect(
          projectList
            .getByRole('button', { name: /^(?:Hatfield #|Claude [a-f0-9])/ })
            .filter({ hasText: 'Needs input' })
        ).toHaveCount(1)
        const attentionStrip = page.getByRole('region', { name: 'Agents needing attention' })
        await expect(attentionStrip).toContainText('Approval needed · agent-project')
        await expect(attentionStrip).toContainText('#hatfield-e2e — Review <draft>')
        await attentionStrip
          .getByRole('button', {
            name: 'Open terminal for #hatfield-e2e — Review <draft>',
            exact: true
          })
          .click()
        await expect(first).toHaveClass(/is-active/)
        await expect(panes).toHaveCount(2)
        await filter.getByRole('button', { name: 'Needs input' }).click()
        await expect(claude).toHaveCount(0)
        const working = filter.getByRole('button', { name: 'Working', exact: true })
        await working.click()
        await working.click()
        await expect(attentionStrip).toBeVisible()
        await expect(working).toHaveAttribute('aria-pressed', 'true')
        await expect(filter.getByRole('button', { name: 'Needs input' })).toHaveAttribute(
          'aria-pressed',
          'false'
        )
        await expect(claude).toContainText('Working')
        await expect(hatfield).toHaveAttribute('aria-description', /Needs input: permission/)
        await filter.getByRole('button', { name: 'All', exact: true }).click()
        await command(page, first, 'resolve')
        await expect(attentionStrip).toHaveCount(0)
        await expect(
          projectList
            .getByRole('button', { name: /^(?:Hatfield #|Claude [a-f0-9])/ })
            .filter({ hasText: 'Needs input' })
        ).toHaveCount(0)
        expect(await treeTop()).toBe(originalTop)
        await command(page, first, 'child')
        await command(page, first, 'completed')
        await expect(hatfield).toHaveAttribute(
          'aria-description',
          /Needs input: question · Last foreground response: completed/
        )
        await command(page, first, 'duplicate', 'duplicate')
        await command(page, first, 'stale', 'stale')
        await expect(
          projectList
            .getByRole('button', { name: /^(?:Hatfield #|Claude [a-f0-9])/ })
            .filter({ hasText: 'Needs input' })
        ).toHaveCount(1)
        await expect(hatfield).toHaveAttribute(
          'aria-description',
          /Needs input: question · Last foreground response: completed/
        )
        await command(page, first, 'child-done')
        await expectLaunchOrder()
        await expect(hatfield).toHaveAttribute(
          'aria-description',
          /Idle · Last foreground response: completed/
        )
        await command(page, first, 'again')
        const rowHeight = (await hatfield.boundingBox())?.height
        expect(rowHeight).toBeDefined()
        await command(page, first, 'child-working')
        await command(page, first, 'script')
        await command(page, first, 'wait')
        await expect(hatfield).toHaveAttribute(
          'aria-description',
          /Active agents: 1 · Background scripts: 1/
        )
        expect((await hatfield.boundingBox())?.height).toBe(rowHeight)
        await filter.getByRole('button', { name: 'Working', exact: true }).click()
        await expect(hatfield).toHaveAttribute('aria-description', /Needs input: permission/)
        await filter.getByRole('button', { name: 'Needs input' }).click()
        await expect(claude).toHaveCount(0)
        await filter.getByRole('button', { name: 'All', exact: true }).click()
        await command(page, first, 'resolve')
        await command(page, first, 'completed')
        await expect(hatfield).toHaveAttribute(
          'aria-description',
          /Working · Last foreground response: completed/
        )
        await expect(hatfield).toHaveAttribute('aria-current', 'true')
        await filter.getByRole('button', { name: 'All', exact: true }).click()
        const idle = filter.getByRole('button', { name: 'Idle', exact: true })
        await idle.click()
        await expect(hatfield).toHaveCount(0)
        await filter.getByRole('button', { name: 'All', exact: true }).click()
        await command(page, first, 'child-done')
        await expect(hatfield).toHaveAttribute('aria-description', /Active agents: 0/)
        await expect(hatfield).toHaveAttribute('aria-description', /Background scripts: 1/)
        await idle.click()
        await expect(hatfield).toHaveAttribute(
          'aria-description',
          /Idle · Last foreground response: completed/
        )
        await expect(hatfield.getByRole('img', { name: 'Background scripts' })).toBeVisible()
        await command(page, first, 'script-done')
        await expect(hatfield).toHaveAttribute(
          'aria-description',
          /Idle · Last foreground response: completed/
        )
        expect((await hatfield.boundingBox())?.height).toBe(rowHeight)
        await filter.getByRole('button', { name: 'All', exact: true }).click()
        await command(page, first, 'again')
        await command(page, first, 'failed')
        await expect(hatfield).toHaveAttribute(
          'aria-description',
          /Stopped · Last foreground response: failed/
        )
        await command(page, second, 'cancelled')
        await expect(claude).toHaveAttribute(
          'aria-description',
          /Stopped · Last foreground response: cancelled/
        )
        await expect(hatfield).toHaveAttribute(
          'aria-description',
          /Stopped · Last foreground response: failed/
        )
        const stopped = filter.getByRole('button', { name: 'Stopped', exact: true })
        const all = filter.getByRole('button', { name: 'All', exact: true })
        await stopped.click()
        await expect(hatfield).toHaveAttribute(
          'aria-description',
          /Stopped · Last foreground response: failed/
        )
        await expect(claude).toHaveAttribute(
          'aria-description',
          /Stopped · Last foreground response: cancelled/
        )
        await all.click()
        await command(page, first, 'child-working')
        await expect(hatfield).toHaveAttribute(
          'aria-description',
          /Working · Last foreground response: failed/
        )
        await command(page, second, 'child')
        await expect(claude).toHaveAttribute(
          'aria-description',
          /Needs input: question · Last foreground response: cancelled/
        )
        await stopped.click()
        await expect(hatfield).toHaveCount(0)
        await expect(claude).toHaveCount(0)
        await all.click()
        await command(page, first, 'child-done')
        await expect(hatfield).toHaveAttribute(
          'aria-description',
          /Stopped · Last foreground response: failed/
        )
        await command(page, second, 'end-reporting')
        await expect(claude).toHaveAttribute(
          'aria-description',
          /Running · Last foreground response: cancelled/
        )
        await stopped.click()
        await expect(claude).toHaveCount(0)
        await all.click()
        await command(page, first, 'again')
        await command(page, first, 'wait')
        await first.click()
        await page.keyboard.type('quit')
        await page.keyboard.press('Enter')
        await expect(hatfield).toHaveCount(0)
        await stopped.click()
        await expect(hatfield).toHaveCount(0)
        await expect(claude).toHaveCount(0)
        await all.click()
        await idle.click()
        await expect(hatfield).toHaveCount(0)
        await all.click()
        await expect(
          projectList
            .getByRole('button', { name: /^(?:Hatfield #|Claude [a-f0-9])/ })
            .filter({ hasText: 'Needs input' })
        ).toHaveCount(0)
        await expect(claude).toHaveAttribute(
          'aria-description',
          /Running · Last foreground response: cancelled/
        )
        await claude.click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Copy session ID' }).click()
        expect(await page.evaluate(() => globalThis.desktop.readTerminalClipboard())).toBe(
          'a3f91c2d-3691-4c2f-b54f-e4db8704bbc1'
        )
        await claude.click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Close terminal' }).click()
        await expect(claude).toHaveCount(0)
      },
      { userDataDir }
    )
  } finally {
    await cleanup()
  }
})

// With E2E_AGENT_DEMO=1 the same run is recorded as a demonstration (docs/agents/agent-launches.md).
test('two agents move through working, needs input, background work and outcomes', async () => {
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
          const hatfield = tree.getByRole('button', { name: /^Hatfield (?:#|·)/ })
          const claude = tree.getByRole('button', { name: /^Claude / })
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
          await expect(hatfield).toHaveAttribute('aria-description', /Needs input: permission/)
          await capture(page, '02-permission')
          await step(first, firstId, 'resolve')
          await step(second, secondId, 'child')
          await expect(claude).toHaveAttribute('aria-description', /Needs input: question/)
          await capture(page, '03-question')
          await step(second, secondId, 'child-done')
          await step(first, firstId, 'child-working')
          await step(first, firstId, 'script')
          await step(first, firstId, 'completed')
          await expect(hatfield).toHaveAttribute(
            'aria-description',
            /Working · Last foreground response: completed/
          )
          await expect(hatfield).toHaveAttribute(
            'aria-description',
            /Active agents: 1 · Background scripts: 1/
          )
          await capture(page, '04-background')
          await step(first, firstId, 'child-done')
          await step(first, firstId, 'script-done')
          await expect(hatfield).toHaveAttribute(
            'aria-description',
            /Idle · Last foreground response: completed/
          )
          await capture(page, '05-idle')
          await step(first, firstId, 'again')
          await step(first, firstId, 'failed')
          await step(second, secondId, 'cancelled')
          await expect(hatfield).toHaveAttribute(
            'aria-description',
            /Stopped · Last foreground response: failed/
          )
          await expect(claude).toHaveAttribute(
            'aria-description',
            /Stopped · Last foreground response: cancelled/
          )
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

test('an explicit launch inherits Bash startup exports and passes literal arguments', async () => {
  test.skip(process.platform !== 'linux', 'Uses an isolated Linux Bash startup file')
  const { project, userDataDir, cleanup } = await seed()
  const home = join(userDataDir, 'shell-home')
  const bin = join(home, 'bin')
  const script = join(home, 'probe.mjs')
  try {
    await mkdir(bin, { recursive: true })
    await symlink(process.execPath, join(bin, 'issue60-agent-probe'))
    await writeFile(
      join(home, '.bashrc'),
      'export PATH="$HOME/bin:$PATH"\nexport ISSUE60_SENTINEL=from-bashrc\ncd "$HOME"\n'
    )
    await writeFile(
      script,
      `console.log('Startup: ' + process.env.ISSUE60_SENTINEL);\n` +
        `console.log('Arguments: ' + JSON.stringify(process.argv.slice(2)));\n` +
        `await import(${JSON.stringify(fixture)});\n`
    )
    await writeFile(
      join(userDataDir, 'settings.json'),
      JSON.stringify({
        'terminal.gpuAcceleration': false,
        'agents.hatfield': {
          executable: 'issue60-agent-probe',
          args: [script, 'hatfield', 'shell-startup', 'literal ; $(false)', '']
        }
      })
    )
    await withApp(
      async (_app, page) => {
        await launch(page, 'Hatfield')
        const pane = page.getByRole('tabpanel', { name: 'Hatfield' }).getByTestId('terminal-pane')
        await expect(output(pane)).toContainText('Startup: from-bashrc')
        await expect(output(pane)).toContainText(
          'Arguments: ["hatfield","shell-startup","literal ; $(false)",""]'
        )
        await expect(output(pane)).toContainText(`Directory: ${project}`)
        await startFocusedScenario(page, pane)
        await expect(
          page.getByRole('button', { name: /Hatfield (?:#|·).*shell-startup/ })
        ).toContainText('Working')
        await page.keyboard.press('Control+d')
        await expect(pane).toHaveCount(0)
        await expect(
          page.getByRole('button', { name: /Hatfield (?:#|·).*shell-startup/ })
        ).toHaveCount(0)
      },
      {
        userDataDir,
        env: {
          HOME: home,
          SHELL: '/bin/bash',
          H360_STATUS_TOKEN: 'invalid-inherited-token',
          H360_STATUS_LAUNCH_ID: 'invalid-inherited-launch'
        }
      }
    )
  } finally {
    await cleanup()
  }
})

test('agent launch settings are validated and a missing executable keeps diagnostics until the pane closes', async () => {
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
        const pane = page.getByTestId('terminal-pane')
        await expect(pane.getByRole('status')).toHaveText('Process exited with code 127')
        await expect(output(pane)).toContainText('missing-agent-command')
        const row = page.getByRole('button', { name: /^Hatfield (?:#|·)/ })
        await expect(row).toContainText('Stopped')
        await page.getByRole('button', { name: 'Close Hatfield', exact: true }).click()
        await expect(row).toHaveCount(0)
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
      'title',
      'tool',
      'updatedAt',
      'wait',
      'worktree'
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
        await command(page, hatfield, 'child-working')
        await expect(needsInput).toHaveCount(1)
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
        await bell.click()
        await expect(panel).toHaveCount(0)
        await page.getByRole('button', { name: 'Files', exact: true }).click()
        await send('child-done')
        await expect(page.getByRole('alert', { name: 'Agent turn completed' })).toBeVisible()
        await bell.click()
        await expect(completed).toHaveCount(1)
        await page.getByRole('button', { name: 'Agents', exact: true }).click()
        const row = page.getByRole('button', { name: /^Hatfield (?:#|·)/ })
        await expect(row).toHaveAttribute(
          'aria-description',
          /Idle · Last foreground response: completed/
        )
        await expect(row.getByRole('img', { name: 'Background scripts' })).toBeVisible()
        await expect(completed).toHaveCount(1)
        await command(page, hatfield, 'script-done')
        await command(page, hatfield, 'script')
        await expect(completed).toHaveCount(1)
        await command(page, hatfield, 'again')
        await command(page, hatfield, 'failed')
        await command(page, hatfield, 'script-done')
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

test('an active subagent blocks completion until the count settles', async () => {
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
        await command(page, pane, 'child-working')
        await command(page, pane, 'completed')
        await expect(page.getByRole('button', { name: /^Hatfield (?:#|·)/ })).toHaveAttribute(
          'aria-description',
          /Last foreground response: completed/
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

test('an unavailable subagent count does not prove completion', async () => {
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
        const session = page.getByRole('button', { name: /^Hatfield (?:#|·)/ })
        await command(page, pane, 'child-working')
        await command(page, pane, 'completed')
        await expect(session).toHaveAttribute(
          'aria-description',
          /Working · Last foreground response: completed/
        )
        await expect(completion).toHaveCount(0)
        await command(page, pane, 'children-unknown')
        await expect(session).toHaveAttribute(
          'aria-description',
          /Running · Last foreground response: completed/
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
        const terminalId = await pane.getAttribute('data-terminal-id')
        if (!terminalId) throw new Error('Agent pane has no terminal ID')
        await page.evaluate((id) => globalThis.desktop.killTerminal(id), terminalId)
        expect(await readFile(join(project, 'hangup-report'), 'utf8')).toBe('accepted')
        await expect(page.getByRole('button', { name: /^Hatfield (?:#|·)/ })).toHaveCount(0)
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
        await command(page, pane, 'child-working')
        await command(page, pane, 'completed')
        await expect(completed).toHaveCount(0)
        await command(page, pane, 'again')
        await command(page, pane, 'cancelled')
        await command(page, pane, 'child-done')
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
        const session = folders.getByRole('button', { name: /^Hatfield (?:#|·)/ })
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

test('pruning missing worktree entries preserves live worktrees and branches', async () => {
  const { repo, projects, cleanup: cleanRepo } = await makeRepo()
  try {
    const missing = join(projects, 'missing-feature')
    const otherMissing = join(projects, 'other-missing')
    const live = join(projects, 'live-feature')
    git(repo, 'worktree', 'add', '-q', '-b', 'missing-feature', missing)
    git(repo, 'worktree', 'add', '-q', '-b', 'other-missing', otherMissing)
    git(repo, 'worktree', 'add', '-q', '-b', 'live-feature', live)
    await rm(missing, { recursive: true })
    await rm(otherMissing, { recursive: true })
    const data = join(live, 'local.txt')
    await writeFile(data, 'keep this local file')
    const { userDataDir, cleanup } = await seed(repo)
    try {
      await withApp(
        async (_app, page) => {
          const missingRow = page.getByRole('listitem', {
            name: 'missing-feature worktree (missing)',
            exact: true
          })
          const otherRow = page.getByRole('listitem', {
            name: 'other-missing worktree (missing)',
            exact: true
          })
          const liveRow = page.getByRole('listitem', { name: 'live-feature worktree', exact: true })
          await expect(otherRow).toBeVisible()
          await expect(liveRow).toBeVisible()
          expect(
            await page.evaluate(
              async ({ project, path }) => {
                try {
                  await globalThis.desktop.pruneMissingWorktrees(project, path)
                  return 'accepted'
                } catch (error) {
                  return String(error)
                }
              },
              { project: repo, path: live }
            )
          ).toContain('no longer eligible for pruning')
          await expect(missingRow).toBeVisible()
          await missingRow.click({ button: 'right' })
          await page
            .getByRole('menuitem', {
              name: 'Prune all missing worktree entries in repository',
              exact: true
            })
            .click()
          await expect(missingRow).toHaveCount(0)
          await expect(otherRow).toHaveCount(0)
          await expect(liveRow).toBeVisible()
          expect(await readFile(data, 'utf8')).toBe('keep this local file')
          git(repo, 'show-ref', '--verify', 'refs/heads/missing-feature')
          git(repo, 'show-ref', '--verify', 'refs/heads/other-missing')
        },
        { userDataDir }
      )
    } finally {
      await cleanup()
    }
  } finally {
    await cleanRepo()
  }
})

test('a linked worktree launches into its own tab and publishes only public session data', async () => {
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
            const primary = page.getByRole('listitem', { name: 'main worktree', exact: true })
            const linked = page.getByRole('listitem', { name: 'feature worktree', exact: true })
            const primarySession = primary
              .getByRole('list', { name: 'main checkout sessions' })
              .getByRole('button', { name: /^Hatfield #hatfield-e2e/ })
            const linkedSessionRow = linked
              .getByRole('list', { name: 'feature checkout sessions' })
              .getByRole('button', { name: /^Claude a3f91c2d/ })
            await expect(primarySession).toBeVisible()
            await expect(linkedSessionRow).toBeVisible()
            await primary.getByRole('button', { name: 'Collapse main checkout' }).click()
            await expect(primarySession).toHaveCount(0)
            await expect(linkedSessionRow).toBeVisible()
            await primary.getByRole('button', { name: 'Expand main checkout' }).click()
            await linked.getByRole('button', { name: 'Collapse feature checkout' }).click()
            await expect(linkedSessionRow).toHaveCount(0)
            await expect(primarySession).toBeVisible()
            await linked.getByRole('button', { name: 'Expand feature checkout' }).click()
            await expect(linkedSessionRow).toBeVisible()
            const worktreeId = await worktreePane.getAttribute('data-terminal-id')
            if (!worktreeId) throw new Error('Linked worktree terminal missing')
            const settings = page.getByRole('main', { name: 'Settings', exact: true })
            const openSettings = page.getByRole('button', { name: 'Settings', exact: true })
            const agentsView = page.getByRole('button', { name: 'Agents', exact: true })
            await openSettings.click()
            await expect(settings).toBeVisible()
            await page.getByRole('button', { name: /^Hatfield (?:#|·)/ }).click()
            await expect(settings).toHaveCount(0)
            await expect(agentsView).toHaveAttribute('aria-pressed', 'true')
            await expect(rootPane).toBeVisible()
            await expect(rootPane.locator('textarea')).toBeFocused()
            await expect(page.getByRole('tab', { name: 'Hatfield', selected: true })).toBeVisible()
            await page.evaluate((id) => globalThis.desktop.writeTerminal(id, 'wait\r'), worktreeId)
            const attention = page.getByRole('button', {
              name: 'Claude a3f91c2d-3691-4c2f-b54f-e4db8704bbc1 · Needs input',
              exact: true
            })
            await expect(attention).toHaveAttribute('aria-description', /Needs input: permission/)
            const scope = page.getByRole('button', { name: 'Filter by project' })
            const search = page.getByRole('combobox', { name: 'Search projects' })
            await scope.click()
            await search.fill('side-pro')
            await expect(page.getByRole('option')).toHaveText(['side-project'])
            await search.press('Enter')
            await expect(scope).toHaveText('side-project')
            await expect(attention).toHaveCount(0)
            await expect(page.getByText('No sessions match this filter.')).toBeVisible()
            await expect(page.getByRole('tab', { name: 'Hatfield', selected: true })).toBeVisible()
            await scope.click()
            await search.fill('all proj')
            await expect(page.getByRole('option')).toHaveText(['All projects'])
            await search.press('Enter')
            await expect(attention).toBeVisible()
            await expect(page.getByRole('tab', { name: 'Hatfield', selected: true })).toBeVisible()
            await expect(rootPane).toHaveClass(/is-active/)
            await openSettings.click()
            await expect(settings).toBeVisible()
            await attention.click({ button: 'right' })
            await page.getByRole('menuitem', { name: 'Go to terminal' }).click()
            await expect(settings).toHaveCount(0)
            await expect(agentsView).toHaveAttribute('aria-pressed', 'true')
            await expect(worktreePane).toBeVisible()
            await expect(worktreePane.locator('textarea')).toBeFocused()
            await expect(page.getByRole('tab', { name: 'Claude', selected: true })).toBeVisible()
            await expect(worktreePane).toHaveAttribute('data-terminal-id', worktreeId)
            await expect(output(worktreePane)).toContainText('ACK wait: accepted')

            const expected = {
              provider: 'claude',
              providerSessionId: 'a3f91c2d-3691-4c2f-b54f-e4db8704bbc1',
              project: repo,
              cwd: worktree,
              worktree,
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
            const linkedSession = folders.getByRole('button', { name: /^Claude / })
            await expect(linkedSession).toHaveCount(1)
            await expect(linkedSession).toHaveAccessibleName(
              'Claude a3f91c2d-3691-4c2f-b54f-e4db8704bbc1 · Needs input'
            )
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

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`

test('manually launched agents follow the managed shell pane and observed directory', async () => {
  test.skip(process.platform !== 'linux', 'Manual registration uses Linux process identity')
  const { project, userDataDir, cleanup } = await seed()
  const side = join(project, '..', 'side-project')
  try {
    await writeFile(
      join(userDataDir, 'settings.json'),
      JSON.stringify({
        'terminal.gpuAcceleration': false,
        'agents.claude': {
          executable: '/usr/bin/env',
          args: [
            `H360_STATUS_BOOTSTRAP_TOKEN=${'b'.repeat(64)}`,
            process.execPath,
            fixture,
            'claude',
            'a3f91c2d-3691-4c2f-b54f-e4db8704bbc1',
            'split'
          ]
        }
      })
    )
    await withApp(
      async (_app, page) => {
        await projectRow(page).click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Open Terminal Here' }).click()
        const pane = page.getByTestId('terminal-pane')
        const run = async (session: string) => {
          await expect(pane.locator('textarea')).toBeFocused()
          await page.keyboard.type(
            `cd ${shellQuote(side)} && ${shellQuote(process.execPath)} ${shellQuote(fixture)} hatfield ${session} ${session}`
          )
          await page.keyboard.press('Enter')
          await expect(output(pane)).toContainText(`Scenario ready: ${session}`)
          await command(page, pane, 'start')
        }
        await run('manual-first')
        const folders = page.getByRole('list', { name: 'Workspace folders' })
        const first = folders.getByRole('button', { name: /Hatfield (?:#|·).*manual-first/ })
        await expect(first).toContainText('Working')
        await expect
          .poll(async () => {
            const snapshot = await page.evaluate(() => globalThis.desktop.getAgentSessions())
            const session = snapshot.sessions.find(
              (entry) => entry.providerSessionId === 'manual-first'
            )
            return { cwd: session?.cwd, project: session?.project }
          })
          .toEqual({ cwd: side, project: side })
        await command(page, pane, 'wait')
        await command(page, pane, 'message')
        await page.getByRole('button', { name: /^Notifications(?: \(\d+\))?$/ }).click()
        const panel = page.getByRole('complementary', { name: 'Notifications panel' })
        const needsInput = panel.getByRole('listitem', { name: 'Agent needs input' })
        const message = panel.getByRole('listitem', { name: 'Review available' })
        await expect(needsInput).toContainText('Hatfield · manual-first')
        await expect(message).toContainText('The report is ready.')
        await page.getByRole('button', { name: 'Settings', exact: true }).click()
        const settings = page.getByRole('main', { name: 'Settings', exact: true })
        await expect(settings).toBeVisible()
        await message.getByRole('button', { name: 'Open terminal' }).click()
        await expect(settings).toHaveCount(0)
        await expect(pane.locator('textarea')).toBeFocused()
        await page.keyboard.type('quit')
        await page.keyboard.press('Enter')
        await expect(first).toContainText('Stopped')
        await expect(panel.getByRole('listitem')).toHaveCount(2)
        await run('manual-second')
        await expect(
          folders.getByRole('button', { name: /Hatfield (?:#|·).*manual-second/ })
        ).toContainText('Working')
        await expect(first).toContainText('Stopped')
        await expect(pane).toHaveCount(1)
        await launch(page, 'Claude')
        const explicitPane = page
          .getByRole('tabpanel', { name: 'Claude' })
          .getByTestId('terminal-pane')
        await expect(output(explicitPane)).toContainText('Scenario ready: split')
        await startFocusedScenario(page, explicitPane)
        await expect(
          page.getByRole('button', { name: /^Claude .*a3f91c2d-3691-4c2f-b54f-e4db8704bbc1/ })
        ).toHaveCount(1)
        await page.getByRole('button', { name: 'Close agent-project', exact: true }).click()
        await expect(
          folders.getByRole('button', { name: /Hatfield (?:#|·).*manual-/ })
        ).toHaveCount(0)
        await expect(explicitPane).toBeVisible()
      },
      {
        userDataDir,
        env: {
          H360_STATUS_BOOTSTRAP_TOKEN: 'a'.repeat(64),
          H360_STATUS_TOKEN: 'invalid-inherited-explicit-token',
          H360_STATUS_LAUNCH_ID: 'invalid-inherited-launch'
        }
      }
    )
  } finally {
    await cleanup()
  }
})

async function placementWorkspace(userDataDir: string, project: string, folder?: string) {
  await writeFile(
    join(userDataDir, 'workspaces/default.hatfield-workspace'),
    JSON.stringify({
      version: 1,
      folders: [
        { path: project, kind: 'project' },
        ...(folder ? [{ path: folder, kind: 'folder' }] : [])
      ]
    })
  )
}

async function launchManualPlacement(
  page: Page,
  projectName: string,
  cwd: string,
  session: string
) {
  const folders = page.getByRole('list', { name: 'Workspace folders' })
  await folders.getByRole('listitem', { name: projectName, exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Open Terminal Here' }).click()
  const pane = page.getByTestId('terminal-pane').filter({ visible: true })
  await expect(pane.locator('textarea')).toBeFocused()
  await page.keyboard.type(
    `cd ${shellQuote(cwd)} && ${shellQuote(process.execPath)} ${shellQuote(fixture)} hatfield ${session} ${session}`
  )
  await page.keyboard.press('Enter')
  await expect(output(pane)).toContainText(`Scenario ready: ${session}`)
  await command(page, pane, 'start')
  return folders.getByRole('button', { name: `Hatfield #${session}` })
}

async function readManualPlacement(page: Page, sessionId: string) {
  const snapshot = await page.evaluate(() => globalThis.desktop.getAgentSessions())
  return snapshot.sessions.find((session) => session.providerSessionId === sessionId)
}

test('manual placement keeps a nested plain folder under its parent project', async () => {
  test.skip(process.platform !== 'linux', 'Manual registration uses Linux process identity')
  const { project, userDataDir, cleanup } = await seed()
  try {
    const src = join(project, 'src')
    await mkdir(src)
    await placementWorkspace(userDataDir, project, src)
    await withApp(
      async (_app, page) => {
        const row = await launchManualPlacement(page, 'agent-project', src, 'nested-folder')
        await expect
          .poll(async () => {
            const session = await readManualPlacement(page, 'nested-folder')
            return { cwd: session?.cwd, project: session?.project }
          })
          .toEqual({ cwd: src, project })
        const folders = page.getByRole('list', { name: 'Workspace folders' })
        await folders.getByRole('button', { name: 'Collapse agent-project' }).click()
        await expect(row).toHaveCount(0)
      },
      { userDataDir }
    )
  } finally {
    await cleanup()
  }
})

test('manual placement retains the workspace alias for a symlinked project', async () => {
  test.skip(process.platform !== 'linux', 'Manual registration uses Linux process identity')
  const { project, userDataDir, cleanup } = await seed()
  try {
    const alias = join(project, '..', 'aliased-project')
    await symlink(project, alias, 'dir')
    await placementWorkspace(userDataDir, alias)
    await withApp(
      async (_app, page) => {
        const row = await launchManualPlacement(page, 'aliased-project', alias, 'alias')
        await expect
          .poll(async () => {
            const session = await readManualPlacement(page, 'alias')
            return { cwd: session?.cwd, project: session?.project }
          })
          .toEqual({ cwd: project, project: alias })
        await expect(row).toBeVisible()
      },
      { userDataDir }
    )
  } finally {
    await cleanup()
  }
})

test('manual placement groups linked worktree subdirectories after Git discovery recovers', async () => {
  test.skip(process.platform !== 'linux', 'Manual registration uses Linux process identity')
  const { repo, projects, cleanup: cleanRepo } = await makeRepo()
  const { userDataDir, cleanup } = await seed(repo)
  try {
    const tree = join(repo, 'feature')
    git(repo, 'worktree', 'add', '-b', 'feature', tree)
    const src = join(tree, 'src')
    const boundary = join(repo, 'feature-other')
    const alias = join(projects, 'feature-alias')
    await mkdir(src)
    await mkdir(boundary)
    await symlink(tree, alias, 'dir')
    const gitDir = join(repo, '.git')
    const backup = join(repo, 'git-backup')
    await rename(gitDir, backup)
    await mkdir(gitDir)
    await withApp(
      async (_app, page) => {
        const folders = page.getByRole('list', { name: 'Workspace folders' })
        await expect(folders.getByRole('alert').filter({ hasText: 'Git:' })).toBeVisible()
        const child = await launchManualPlacement(page, 'app', join(alias, 'src'), 'linked-subdir')
        await expect(child).toBeVisible()
        await rmdir(gitDir)
        await rename(backup, gitDir)
        const feature = folders.getByRole('listitem', { name: 'feature worktree', exact: true })
        await expect(feature).toBeVisible()
        const nested = feature
          .getByRole('list', { name: 'feature checkout sessions' })
          .getByRole('button', { name: /linked-subdir/ })
        await expect(nested).toBeVisible()
        const outside = await launchManualPlacement(page, 'app', boundary, 'boundary')
        await expect(outside).toBeVisible()
        await expect
          .poll(async () => {
            const session = await readManualPlacement(page, 'linked-subdir')
            return { cwd: session?.cwd, project: session?.project, worktree: session?.worktree }
          })
          .toEqual({ cwd: src, project: repo, worktree: tree })
        await expect
          .poll(async () => {
            const session = await readManualPlacement(page, 'boundary')
            return { cwd: session?.cwd, project: session?.project, worktree: session?.worktree }
          })
          .toEqual({ cwd: boundary, project: repo, worktree: null })
        await expect(nested).toBeVisible()
        await folders.getByRole('button', { name: 'Collapse app' }).click()
        await expect(child).toHaveCount(0)
        await expect(outside).toHaveCount(0)
        await folders.getByRole('button', { name: 'Expand app' }).click()
        await expect(nested).toBeVisible()
      },
      { userDataDir }
    )
  } finally {
    await cleanup()
    await cleanRepo()
  }
})
