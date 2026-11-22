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
/** What the page script reads of a line (the tests are typed for Node, without the DOM). */
type ShownLine = { style: { top: string }; textContent: string | null }

/**
 * The shown lines' text in document order. The editor reuses line elements, so their order in the
 * page isn't the document's; each is placed by its `top`.
 */
export const editorText = (page: Page): Promise<string> =>
  lines(page)
    .locator('.view-line')
    .evaluateAll((shown: ShownLine[]) =>
      shown
        .toSorted((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top))
        .map((line) => (line.textContent ?? '').replaceAll(String.fromCharCode(0xa0), ' '))
        .join('\n')
    )
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
