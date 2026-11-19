import { expect, test, type Page } from '@playwright/test'
import { saveScreenshot, withApp } from './launch-app'

const viewButton = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name, exact: true })
const sidePanel = (page: Page, view: string) =>
  page.getByRole('complementary', { name: `${view} panel` })
const resizeHandle = (page: Page, view: string) =>
  page.getByRole('separator', { name: `Resize ${view} panel` })

async function panelWidth(page: Page, view: string): Promise<number> {
  const box = await sidePanel(page, view).boundingBox()
  if (!box) throw new Error(`${view} panel is not rendered`)
  return Math.round(box.width)
}

test('activity bar switches between the Agents, Files and Git views', async () => {
  await withApp(async (_app, page) => {
    await expect(viewButton(page, 'Agents')).toHaveAttribute('aria-pressed', 'true')
    await expect(sidePanel(page, 'Agents').getByRole('heading')).toHaveText('Agent Sessions')
    await expect(page.getByRole('main', { name: 'Agents' })).toContainText('Terminals')

    await viewButton(page, 'Files').click()
    await expect(viewButton(page, 'Files')).toHaveAttribute('aria-pressed', 'true')
    await expect(viewButton(page, 'Agents')).toHaveAttribute('aria-pressed', 'false')
    await expect(sidePanel(page, 'Agents')).toHaveCount(0)
    await expect(sidePanel(page, 'Files').getByRole('heading')).toHaveText('Project')
    await expect(page.getByRole('main', { name: 'Files' })).toContainText('editor tabs')

    await viewButton(page, 'Git').click()
    await expect(sidePanel(page, 'Git').getByRole('heading')).toHaveText('Commit')
    await expect(page.getByRole('main', { name: 'Git' })).toContainText('diff')

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

test('side panel resizes by dragging and by keyboard, within 180 to 640 px', async () => {
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
    await expect(handle).toHaveAttribute('aria-valuenow', '640')
    expect(await panelWidth(page, 'Agents')).toBe(640)
  })
})

test('a narrow window shrinks the side panel so the main area stays on screen', async () => {
  await withApp(async (app, page) => {
    const setWindowWidth = (width: number) =>
      app.evaluate(({ BrowserWindow }, newWidth) => {
        const window = BrowserWindow.getAllWindows()[0]
        if (!window) throw new Error('no window')
        window.setSize(newWidth, 800)
      }, width)

    await resizeHandle(page, 'Agents').focus()
    await page.keyboard.press('End')
    expect(await panelWidth(page, 'Agents')).toBe(640)

    await setWindowWidth(600)
    await expect.poll(() => page.evaluate('window.innerWidth')).toBe(600)
    await expect.poll(() => panelWidth(page, 'Agents')).toBeLessThan(640)
    const main = await page.getByRole('main', { name: 'Agents' }).boundingBox()
    const handle = await resizeHandle(page, 'Agents').boundingBox()
    if (!main || !handle) throw new Error('layout is not rendered')
    expect(main.x + main.width).toBeLessThanOrEqual(600)
    expect(main.width).toBeGreaterThanOrEqual(320)
    expect(handle.x + handle.width).toBeLessThan(main.x + 1)
    expect(await page.evaluate('document.documentElement.scrollWidth')).toBe(600)

    // The chosen width is kept and comes back when there is room again.
    await setWindowWidth(1200)
    await expect.poll(() => panelWidth(page, 'Agents')).toBe(640)
  })
})

test('each view keeps its own side panel width and collapsed state', async () => {
  await withApp(async (_app, page) => {
    await viewButton(page, 'Files').click()
    await resizeHandle(page, 'Files').focus()
    await page.keyboard.press('End')
    await expect(resizeHandle(page, 'Files')).toHaveAttribute('aria-valuenow', '640')

    await viewButton(page, 'Git').click()
    await viewButton(page, 'Git').click()
    await expect(sidePanel(page, 'Git')).toHaveCount(0)

    await viewButton(page, 'Agents').click()
    expect(await panelWidth(page, 'Agents')).toBe(300)

    await viewButton(page, 'Files').click()
    expect(await panelWidth(page, 'Files')).toBe(640)

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
