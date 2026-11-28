import { SLOW_MS } from '../../shared/diagnostics-api'

/** IPC requests main has started handling and not finished, for naming what a stall interrupted. */
const inFlight = new Map<number, { channel: string; start: number }>()
let nextId = 0
let onSlowHandler: (channel: string, duration: number) => void = () => {}

/** Who hears of a handler that ran SLOW_MS or more before returning, blocking main all that time. */
export function listenForSlowHandlers(listener: (channel: string, duration: number) => void): void {
  onSlowHandler = listener
}

/** Runs `handle` for `channel`, recorded as in flight until it settles. */
export function trackRequest<T>(channel: string, handle: () => T): T {
  const id = nextId++
  const start = performance.now()
  inFlight.set(id, { channel, start })
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
  } finally {
    // Only the part before the first await: what an async handler does later isn't counted here.
    const duration = performance.now() - start
    if (duration >= SLOW_MS) onSlowHandler(channel, duration)
  }
}

/** The requests in flight now, with how long ago each started. */
export function requestsInFlight(): { channel: string; age: number }[] {
  const now = performance.now()
  return [...inFlight.values()].map(({ channel, start }) => ({ channel, age: now - start }))
}
