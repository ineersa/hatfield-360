import type { ElectronApplication } from '@playwright/test'

/** Runs a native menu item's handler, as a click on it would. */
export async function clickMenuItem(app: ElectronApplication, id: string): Promise<void> {
  await app.evaluate(({ Menu }, itemId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(itemId)
    if (!item) throw new Error(`no menu item ${itemId}`)
    // MenuItem.click is typed as a bare Function; it runs the item's handler like a real click.
    Reflect.apply(item.click, item, [])
  }, id)
}

/** Labels of a menu item's submenu, without separators. */
export function submenuLabels(app: ElectronApplication, id: string): Promise<string[] | undefined> {
  return app.evaluate(
    ({ Menu }, itemId) =>
      Menu.getApplicationMenu()
        ?.getMenuItemById(itemId)
        ?.submenu?.items.filter((item) => item.type !== 'separator')
        .map((item) => item.label),
    id
  )
}
