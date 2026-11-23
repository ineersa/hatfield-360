/** Crashes this close together count towards giving up. */
const CRASH_WINDOW_MS = 3 * 60_000
/** Restarts allowed within the window; the next crash is reported instead. */
const RESTART_LIMIT = 3
const FIRST_DELAY_MS = 500

/**
 * How long to wait before restarting something that just crashed, given when it crashed before
 * (newest last, the crash just now excluded), or null to stop restarting it.
 */
export function restartDelay(earlierCrashes: readonly number[], now: number): number | null {
  const recent = earlierCrashes.filter((time) => now - time < CRASH_WINDOW_MS).length
  return recent >= RESTART_LIMIT ? null : FIRST_DELAY_MS * 2 ** recent
}
