/** Finding and driving the Files view's tree and editor tabs. */
import type { Page } from '@playwright/test'

const tree = (page: Page) => page.getByRole('tree', { name: 'Files' })
export const item = (page: Page, name: string) =>
  tree(page).getByRole('treeitem', { name, exact: true })
export const tabs = (page: Page) =>
  page.getByRole('tablist', { name: 'Editor tabs' }).getByRole('tab')
export const tab = (page: Page, name: string) =>
  page.getByRole('tablist', { name: 'Editor tabs' }).getByRole('tab', { name, exact: true })
export const editor = (page: Page) => page.locator('.monaco-editor')
export const lines = (page: Page) => editor(page).locator('.view-lines')
export const showView = (page: Page, name: 'Agents' | 'Files') =>
  page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name, exact: true }).click()

/** Opens a file from the tree with a double click, expanding the folders on the way. */
export async function openFile(page: Page, ...path: string[]): Promise<void> {
  for (const folder of path.slice(0, -1)) {
    if ((await item(page, folder).getAttribute('aria-expanded')) !== 'true') {
      await item(page, folder).click()
    }
  }
  await item(page, path.at(-1) ?? '').dblclick()
}

/** Puts the caret at the end of the text and types there. */
export async function typeAtEnd(page: Page, text: string): Promise<void> {
  await lines(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type(text)
}
