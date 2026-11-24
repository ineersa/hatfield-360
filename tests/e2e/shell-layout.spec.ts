import { expect, test, type Page } from '@playwright/test'
import { makeTempDir, saveScreenshot, withApp } from './launch-app'

const viewButton = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name, exact: true })
const sidePanel = (page: Page, view: string) =>
  page.getByRole('complementary', { name: `${view} panel` })
const resizeHandle = (page: Page, view: string) =>
  page.getByRole('separator', { name: `Resize ${view} panel` })

const bell = (page: Page) =>
  page
    .getByRole('navigation', { name: 'Tool windows' })
    .getByRole('button', { name: /^Notifications/ })

async function panelWidth(page: Page, view: string): Promise<number> {
  const box = await sidePanel(page, view).boundingBox()
  if (!box) throw new Error(`${view} panel is not rendered`)
  return Math.round(box.width)
}

test('activity bar switches between the Agents, Files and Git views', async () => {
  await withApp(async (_app, page) => {
    await expect(viewButton(page, 'Agents')).toHaveAttribute('aria-pressed', 'true')
    await expect(
      sidePanel(page, 'Agents').getByRole('heading', { name: 'Agents', exact: true, level: 2 })
    ).toBeVisible()
    // An empty workspace shows the welcome screen in every view's main area.
    await expect(page.getByRole('main', { name: 'Agents' })).toContainText('has no folders yet')

    await viewButton(page, 'Files').click()
    await expect(viewButton(page, 'Files')).toHaveAttribute('aria-pressed', 'true')
    await expect(viewButton(page, 'Agents')).toHaveAttribute('aria-pressed', 'false')
    await expect(sidePanel(page, 'Agents')).toHaveCount(0)
    await expect(sidePanel(page, 'Files').getByRole('heading')).toHaveText('Files')
    await expect(page.getByRole('main', { name: 'Files' })).toContainText('has no folders yet')

    await viewButton(page, 'Git').click()
    await expect(sidePanel(page, 'Git').getByRole('heading')).toHaveText('Commit')
    await expect(page.getByRole('main', { name: 'Git' })).toContainText('has no folders yet')

    await viewButton(page, 'Agents').hover()
    await expect(page.getByRole('tooltip')).toContainText('Workspace, worktrees and agent sessions')
  })
})

test('clicking the active view button collapses and expands its side panel', async () => {
  await withApp(async (_app, page) => {
    await viewButton(page, 'Agents').click()
    await expect(sidePanel(page, 'Agents')).toHaveCount(0)
    await expect(viewButton(page, 'Agents')).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByRole('main', { name: 'Agents' })).toBeVisible()

    await viewButton(page, 'Agents').click()
    await expect(sidePanel(page, 'Agents')).toBeVisible()
    await expect(viewButton(page, 'Agents')).toHaveAttribute('aria-expanded', 'true')
  })
})

test('the Settings rail button toggles Settings without losing the previous view', async () => {
  await withApp(async (_app, page) => {
    const files = viewButton(page, 'Files')
    const settings = viewButton(page, 'Settings')
    await files.click()
    await files.click()
    await expect(files).toHaveAttribute('aria-expanded', 'false')
    await settings.click()
    await expect(page.getByRole('main', { name: 'Settings' })).toBeVisible()
    await settings.click()
    await expect(page.getByRole('main', { name: 'Files' })).toBeVisible()
    await expect(files).toHaveAttribute('aria-expanded', 'false')
    await settings.click()
    await expect(page.getByRole('main', { name: 'Settings' })).toBeVisible()
  })
})

async function mainWidth(page: Page, view: string): Promise<number> {
  const box = await page.getByRole('main', { name: view }).boundingBox()
  if (!box) throw new Error(`${view} main area is not rendered`)
  return Math.round(box.width)
}

test('side panel resizes by dragging and by keyboard, from 180 px up to a 120 px main area', async () => {
  await withApp(async (_app, page) => {
    expect(await panelWidth(page, 'Agents')).toBe(300)

    const handle = resizeHandle(page, 'Agents')
    const box = await handle.boundingBox()
    if (!box) throw new Error('resize handle is not rendered')
    const y = box.y + box.height / 2
    await page.mouse.move(box.x + box.width / 2, y)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 120, y, { steps: 5 })
    await page.mouse.up()
    await expect(handle).toHaveAttribute('aria-valuenow', '420')
    expect(await panelWidth(page, 'Agents')).toBe(420)

    await page.mouse.move(box.x + box.width / 2 + 120, y)
    await page.mouse.down()
    await page.mouse.move(box.x - 1000, y, { steps: 5 })
    await page.mouse.up()
    await expect(handle).toHaveAttribute('aria-valuenow', '180')

    await handle.focus()
    await page.keyboard.press('ArrowRight')
    await expect(handle).toHaveAttribute('aria-valuenow', '196')
    await page.keyboard.press('End')
    expect(await panelWidth(page, 'Agents')).toBeGreaterThan(900)
    expect(await mainWidth(page, 'Agents')).toBe(120)

    // Dragging past the window edge stops at the same limit.
    await page.keyboard.press('Home')
    const start = await handle.boundingBox()
    if (!start) throw new Error('resize handle is not rendered')
    await page.mouse.move(start.x + start.width / 2, y)
    await page.mouse.down()
    await page.mouse.move(start.x + 3000, y, { steps: 5 })
    await page.mouse.up()
    expect(await mainWidth(page, 'Agents')).toBe(120)
  })
})

test('a narrow window shrinks the side panel so the main area stays on screen', async () => {
  await withApp(async (app, page) => {
    const setWindowWidth = (width: number) =>
      app.evaluate(({ BrowserWindow }, newWidth) => {
        const window = BrowserWindow.getAllWindows()[0]
        if (!window) throw new Error('no window')
        window.setContentSize(newWidth, 800)
      }, width)

    // Window managers adjust requested sizes slightly, so the window goes back to the width it had.
    const startWidth = Number(await page.evaluate('window.innerWidth'))
    await resizeHandle(page, 'Agents').focus()
    await page.keyboard.press('End')
    const chosenWidth = await panelWidth(page, 'Agents')
    expect(chosenWidth).toBeGreaterThan(900)

    await setWindowWidth(600)
    // Window managers may adjust the requested size by a few pixels; check against what was applied.
    await expect.poll(() => page.evaluate('window.innerWidth')).toBeLessThan(620)
    await expect.poll(() => panelWidth(page, 'Agents')).toBeLessThan(chosenWidth)
    const viewportWidth = Number(await page.evaluate('window.innerWidth'))
    const main = await page.getByRole('main', { name: 'Agents' }).boundingBox()
    const handle = await resizeHandle(page, 'Agents').boundingBox()
    if (!main || !handle) throw new Error('layout is not rendered')
    expect(main.x + main.width).toBeLessThanOrEqual(viewportWidth)
    expect(main.width).toBeGreaterThanOrEqual(120)
    expect(handle.x + handle.width).toBeLessThan(main.x + 1)
    expect(await page.evaluate('document.documentElement.scrollWidth')).toBe(viewportWidth)

    // The chosen width is kept and comes back when there is room again.
    await setWindowWidth(startWidth)
    await expect.poll(() => panelWidth(page, 'Agents')).toBe(chosenWidth)
  })
})

test('in a narrow window the notifications panel gives way, so the side panel and main area keep their room', async () => {
  await withApp(async (app, page) => {
    await bell(page).click()
    await resizeHandle(page, 'Notifications').focus()
    await page.keyboard.press('End')
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      if (!window) throw new Error('no window')
      window.setContentSize(600, 800)
    })
    await expect.poll(() => page.evaluate('window.innerWidth')).toBeLessThan(620)
    const viewportWidth = Number(await page.evaluate('window.innerWidth'))
    const main = await page.getByRole('main', { name: 'Agents' }).boundingBox()
    const notifications = await sidePanel(page, 'Notifications').boundingBox()
    const bellBox = await bell(page).boundingBox()
    if (!main || !notifications || !bellBox) throw new Error('layout is not rendered')
    expect(await panelWidth(page, 'Agents')).toBe(180)
    expect(main.width).toBeGreaterThanOrEqual(120)
    expect(notifications.x).toBeGreaterThan(main.x + main.width)
    expect(notifications.width).toBeGreaterThan(0)
    expect(bellBox.x + bellBox.width).toBeLessThanOrEqual(viewportWidth)
    expect(await page.evaluate('document.documentElement.scrollWidth')).toBe(viewportWidth)
    await saveScreenshot(page, 'notifications-narrow-window')
  })
})

test('each view keeps its own side panel width and collapsed state', async () => {
  await withApp(async (_app, page) => {
    await viewButton(page, 'Files').click()
    await resizeHandle(page, 'Files').focus()
    await page.keyboard.press('ArrowRight')
    await expect(resizeHandle(page, 'Files')).toHaveAttribute('aria-valuenow', '316')

    await viewButton(page, 'Git').click()
    await viewButton(page, 'Git').click()
    await expect(sidePanel(page, 'Git')).toHaveCount(0)

    await viewButton(page, 'Agents').click()
    expect(await panelWidth(page, 'Agents')).toBe(300)

    await viewButton(page, 'Files').click()
    expect(await panelWidth(page, 'Files')).toBe(316)

    await viewButton(page, 'Git').click()
    await expect(sidePanel(page, 'Git')).toHaveCount(0)
    await expect(page.getByRole('main', { name: 'Git' })).toBeVisible()
  })
})

test('shell uses the Islands Dark app theme: islands on a darker-edged frame', async () => {
  await withApp(async (_app, page) => {
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'islands-dark')
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(38, 40, 44)')
    await expect(viewButton(page, 'Agents')).toHaveCSS('background-color', 'rgb(56, 113, 225)')

    for (const view of ['Agents', 'Files', 'Git']) {
      // Agents is already active; clicking it again would collapse its panel.
      if (view !== 'Agents') await viewButton(page, view).click()
      await expect(sidePanel(page, view)).toHaveCSS('background-color', 'rgb(25, 26, 28)')
      await expect(page.getByRole('main', { name: view })).toHaveCSS(
        'background-color',
        'rgb(25, 26, 28)'
      )
      await saveScreenshot(page, `shell-${view.toLowerCase()}`)
    }
  })
})

test('the notifications panel resizes from its left edge and keeps its width after a restart', async () => {
  const [userData, cleanUserData] = await makeTempDir('user-data')
  try {
    await withApp(
      async (_app, page) => {
        await bell(page).click()
        expect(await panelWidth(page, 'Notifications')).toBe(380)

        // Dragging the handle left widens the panel on its right.
        const handle = resizeHandle(page, 'Notifications')
        const box = await handle.boundingBox()
        if (!box) throw new Error('resize handle is not rendered')
        const y = box.y + box.height / 2
        await page.mouse.move(box.x + box.width / 2, y)
        await page.mouse.down()
        await page.mouse.move(box.x + box.width / 2 - 100, y, { steps: 5 })
        await page.mouse.up()
        await expect(handle).toHaveAttribute('aria-valuenow', '480')
        expect(await panelWidth(page, 'Notifications')).toBe(480)

        await handle.focus()
        await page.keyboard.press('ArrowLeft')
        await expect(handle).toHaveAttribute('aria-valuenow', '496')
        // At most half the row, so the side panel and the main area keep the rest.
        await page.keyboard.press('End')
        const row = Number(await page.evaluate('window.innerWidth'))
        expect(await panelWidth(page, 'Notifications')).toBeLessThan(row / 2)
        await page.keyboard.press('Home')
        await expect(handle).toHaveAttribute('aria-valuenow', '180')
        await page.keyboard.press('ArrowLeft')
        await expect(handle).toHaveAttribute('aria-valuenow', '196')
      },
      { userDataDir: userData }
    )
    await withApp(
      async (_app, page) => {
        await bell(page).click()
        expect(await panelWidth(page, 'Notifications')).toBe(196)
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
  }
})
