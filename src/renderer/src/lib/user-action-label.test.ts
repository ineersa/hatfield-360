import { expect, it } from 'vitest'
import { actionBefore, type KeyAction, keyActionLabel } from './user-action-label'

const press = (key: string, code: string, modifiers: Partial<KeyAction> = {}): KeyAction => ({
  key,
  code,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
  ...modifiers
})

it('logs a typed character as typing, never the character', () => {
  expect(keyActionLabel(press('a', 'KeyA'))).toBe('typing')
  expect(keyActionLabel(press('A', 'KeyA', { shiftKey: true }))).toBe('typing')
  // Option+2 types @ on many macOS layouts.
  expect(keyActionLabel(press('@', 'Digit2', { altKey: true }))).toBe('typing')
  expect(keyActionLabel(press(' ', 'Space'))).toBe('typing')
})

it('names shortcuts by physical key and named keys by name, and skips a lone modifier', () => {
  expect(keyActionLabel(press('w', 'KeyW', { ctrlKey: true }))).toBe('key Ctrl+W')
  expect(keyActionLabel(press('ц', 'KeyW', { metaKey: true }))).toBe('key Meta+W')
  expect(keyActionLabel(press('Enter', 'Enter'))).toBe('key Enter')
  expect(keyActionLabel(press('Tab', 'Tab', { shiftKey: true }))).toBe('key Shift+Tab')
  expect(keyActionLabel(press('Shift', 'ShiftLeft', { shiftKey: true }))).toBeNull()
})

it('matches a frame to the last action before it, never to one that came after', () => {
  const actions = [
    { label: 'click "Files"', at: 100 },
    { label: 'key Ctrl+W', at: 400 },
    { label: 'click "Close"', at: 900 }
  ]
  expect(actionBefore(actions, 650)).toEqual({ label: 'key Ctrl+W', before: 250 })
  expect(actionBefore(actions, 50)).toBeNull()
})
