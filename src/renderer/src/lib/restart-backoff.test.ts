import { describe, expect, it } from 'vitest'
import { restartDelay } from './restart-backoff'

describe('restartDelay', () => {
  it('doubles the wait with each recent crash and gives up after three restarts', () => {
    const now = 1_000_000
    expect(restartDelay([], now)).toBe(500)
    expect(restartDelay([now - 5_000], now)).toBe(1_000)
    expect(restartDelay([now - 9_000, now - 5_000], now)).toBe(2_000)
    expect(restartDelay([now - 9_000, now - 5_000, now - 1_000], now)).toBeNull()
  })

  it('forgets crashes older than three minutes', () => {
    const now = 1_000_000
    expect(restartDelay([now - 200_000, now - 190_000, now - 1_000], now)).toBe(1_000)
  })
})
