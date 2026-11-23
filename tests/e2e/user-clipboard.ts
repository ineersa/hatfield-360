import type { ElectronApplication } from '@playwright/test'

/** Tests that use the system clipboard carry this tag; they run one at a time (see the Playwright config). */
export const CLIPBOARD_TAG = '@clipboard'

/**
 * On a real display a test shares the user's clipboard: its text is saved and put back by the
 * returned function. An image can't be (reading it crashes Electron 45's main process), so the test
 * fails and says so instead of destroying it. Under xvfb and in CI the clipboard is the test run's.
 */
export async function keepUserClipboard(app: ElectronApplication): Promise<() => Promise<void>> {
  const hasImage = await app.evaluate(async ({ clipboard }) =>
    (await clipboard.read()).some((item) => item.types.some((type) => type.startsWith('image/')))
  )
  if (hasImage) {
    throw new Error(
      'The clipboard holds an image, which the test could not put back. Copy some text and rerun.'
    )
  }
  const text = await app.evaluate(({ clipboard }) => clipboard.readText())
  return () => app.evaluate(({ clipboard }, saved) => clipboard.writeText(saved), text)
}
