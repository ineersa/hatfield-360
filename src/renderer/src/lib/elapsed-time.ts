const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** How long ago `at` was, short: `5m`, `3h`, `yesterday`, `4d`. */
export function elapsedSince(at: number, now: number): string {
  const elapsed = now - at
  if (elapsed < HOUR) return `${Math.max(1, Math.round(elapsed / MINUTE))}m`
  if (elapsed < DAY) return `${Math.round(elapsed / HOUR)}h`
  if (elapsed < 2 * DAY) return 'yesterday'
  return `${Math.floor(elapsed / DAY)}d`
}

/** `5m ago`, `yesterday`, `4d ago`; from now unless `now` is given. */
export function agoText(at: number, now = Date.now()): string {
  const elapsed = elapsedSince(at, now)
  return elapsed === 'yesterday' ? elapsed : `${elapsed} ago`
}
