import { describe, expect, it } from 'vitest'
import { isBackgroundLaunch } from './window-launch-mode'

describe('isBackgroundLaunch', () => {
  it('is enabled only by the exact value 1', () => {
    expect(isBackgroundLaunch({ APP_BACKGROUND_LAUNCH: '1' })).toBe(true)
    expect(isBackgroundLaunch({ APP_BACKGROUND_LAUNCH: 'true' })).toBe(false)
    expect(isBackgroundLaunch({})).toBe(false)
  })
})
