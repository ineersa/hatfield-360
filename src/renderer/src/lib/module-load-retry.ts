/** Waits between attempts: under `pnpm dev`, a network change cuts off module loads that a retry gets. */
const RETRY_DELAYS_MS = [300, 1000, 2000]

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** `load()`, a dynamic import, tried again after each failure; a failed import isn't cached. */
export async function importWithRetry<T>(load: () => Promise<T>): Promise<T> {
  for (const delay of RETRY_DELAYS_MS) {
    try {
      return await load()
    } catch {
      await wait(delay)
    }
  }
  return load()
}
