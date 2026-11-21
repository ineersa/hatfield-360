import { describe, expect, it } from 'vitest'
import { copyPathFormForKey } from './copy-path-keys'

const key = (
  code: string,
  modifiers: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean } = {}
) => ({
  code,
  ctrlKey: modifiers.ctrl ?? false,
  shiftKey: modifiers.shift ?? false,
  altKey: modifiers.alt ?? false,
  metaKey: modifiers.meta ?? false
})

describe('copyPathFormForKey', () => {
  it('copies the absolute path with Ctrl+Shift+C and the relative one with Alt added', () => {
    expect(copyPathFormForKey(key('KeyC', { ctrl: true, shift: true }), 'linux')).toBe('absolute')
    expect(copyPathFormForKey(key('KeyC', { ctrl: true, shift: true, alt: true }), 'win32')).toBe(
      'relative'
    )
  })

  it('uses Command instead of Ctrl on macOS', () => {
    expect(copyPathFormForKey(key('KeyC', { meta: true, shift: true }), 'darwin')).toBe('absolute')
    expect(copyPathFormForKey(key('KeyC', { ctrl: true, shift: true }), 'darwin')).toBeNull()
    expect(copyPathFormForKey(key('KeyC', { meta: true, shift: true }), 'linux')).toBeNull()
  })

  it('leaves plain copy and other keys alone', () => {
    expect(copyPathFormForKey(key('KeyC', { ctrl: true }), 'linux')).toBeNull()
    expect(copyPathFormForKey(key('KeyV', { ctrl: true, shift: true }), 'linux')).toBeNull()
  })
})
