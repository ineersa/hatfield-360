/** IPC requests main has started handling and not finished, for naming what a stall interrupted. */
const inFlight = new Map<number, { channel: string; start: number }>()
let nextId = 0

/** Runs `handle` for `channel`, recorded as in flight until it settles. */
export function trackRequest<T>(channel: string, handle: () => T): T {
  const id = nextId++
  inFlight.set(id, { channel, start: performance.now() })
  const done = (): void => {
    inFlight.delete(id)
  }
  try {
    const result = handle()
    if (result instanceof Promise) result.then(done, done)
    else done()
    return result
  } catch (error) {
    done()
    throw error
  }
}

/** The requests in flight now, with how long ago each started. */
export function requestsInFlight(): { channel: string; age: number }[] {
  const now = performance.now()
  return [...inFlight.values()].map(({ channel, start }) => ({ channel, age: now - start }))
}
