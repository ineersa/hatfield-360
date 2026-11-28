import { SLOW_MS } from './performance-log'

/** How often main checks that its event loop runs; a tick this late means it was blocked. */
const TICK_MS = 100

/** Calls `onStall` with how long main's event loop was blocked, for each block of SLOW_MS or more. */
export function watchMainStalls(onStall: (duration: number) => void): () => void {
  let last = performance.now()
  const timer = setInterval(() => {
    const now = performance.now()
    const blocked = now - last - TICK_MS
    last = now
    if (blocked >= SLOW_MS) onStall(blocked)
  }, TICK_MS)
  // Never keeps the app alive on its own.
  timer.unref()
  return () => clearInterval(timer)
}
