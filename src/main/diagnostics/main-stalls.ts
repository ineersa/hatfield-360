import { SLOW_MS } from '../../shared/diagnostics-api'

/** How often main checks that its event loop runs; a tick this late means it was blocked. */
const TICK_MS = 100

/** How long main's event loop was blocked between two ticks, or null for a block nobody would notice. */
export function stallBetween(previous: number, current: number): number | null {
  const blocked = current - previous - TICK_MS
  return blocked >= SLOW_MS ? blocked : null
}

/**
 * Calls `onStall` with how long main's event loop was blocked, for each block of SLOW_MS or more.
 * A late tick can also be the system holding timers back (App Nap, sleep), so callers decide which
 * ones count.
 */
export function watchMainStalls(onStall: (duration: number) => void): () => void {
  let last = performance.now()
  const timer = setInterval(() => {
    const now = performance.now()
    const blocked = stallBetween(last, now)
    last = now
    if (blocked !== null) onStall(blocked)
  }, TICK_MS)
  // Never keeps the app alive on its own.
  timer.unref()
  return () => clearInterval(timer)
}
