import type { ElectronApplication } from '@playwright/test'

/**
 * On a real display a test shares the user's clipboard. Plain text is saved and put back;
 * anything else (an image) can't be (reading its contents crashes Electron 45's main process),
 * so the test skips rather than lose it. Under xvfb and in CI the clipboard is the test's.
 */
export async function keepUserClipboard(
  app: ElectronApplication
): Promise<(() => Promise<void>) | null> {
  const textOnly = await app.evaluate(async ({ clipboard }) =>
    (await clipboard.read()).every((item) =>
      item.types.every((type) => type.startsWith('text/plain'))
    )
  )
  if (!textOnly) return null
  const text = await app.evaluate(({ clipboard }) => clipboard.readText())
  return () => app.evaluate(({ clipboard }, saved) => clipboard.writeText(saved), text)
}
