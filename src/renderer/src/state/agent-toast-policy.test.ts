import { expect, test } from 'vitest'
import { shouldShowAgentToast } from './agent-toast-policy'

test('a focused visible window suppresses an automatic toast only for a shown terminal', () => {
  expect(shouldShowAgentToast('needs-input', true, true)).toBe(false)
  expect(shouldShowAgentToast('needs-input', true, false)).toBe(true)
})

test('an explicit message is eligible for a toast even when its terminal is being viewed', () => {
  expect(shouldShowAgentToast('explicit', true, true)).toBe(true)
})
