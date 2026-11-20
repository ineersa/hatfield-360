import { describe, expect, it } from 'vitest'
import { terminalCommandForKey } from './terminal-shortcut-match'

const key = (
  code: string,
  modifiers: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean }
) => ({
  code,
  ctrlKey: modifiers.ctrl ?? false,
  shiftKey: modifiers.shift ?? false,
  altKey: modifiers.alt ?? false,
  metaKey: modifiers.meta ?? false
})

describe('terminalCommandForKey', () => {
  it('reads the Linux and Windows shortcuts', () => {
    expect(terminalCommandForKey(key('KeyD', { ctrl: true, shift: true }), 'linux')).toBe(
      'split-right'
    )
    expect(terminalCommandForKey(key('KeyD', { alt: true, shift: true }), 'win32')).toBe(
      'split-down'
    )
    expect(terminalCommandForKey(key('KeyW', { ctrl: true, shift: true }), 'linux')).toBe(
      'close-pane'
    )
    expect(terminalCommandForKey(key('BracketRight', { ctrl: true, shift: true }), 'linux')).toBe(
      'focus-next-pane'
    )
    expect(terminalCommandForKey(key('PageUp', { ctrl: true }), 'linux')).toBe('previous-tab')
  })

  it("leaves the shell's own Ctrl keys alone", () => {
    for (const code of ['KeyD', 'KeyW', 'KeyT', 'BracketRight']) {
      expect(terminalCommandForKey(key(code, { ctrl: true }), 'linux')).toBeNull()
    }
  })

  it('reads the macOS Command shortcuts and not their Linux forms', () => {
    expect(terminalCommandForKey(key('KeyD', { meta: true }), 'darwin')).toBe('split-right')
    expect(terminalCommandForKey(key('KeyD', { meta: true, shift: true }), 'darwin')).toBe(
      'split-down'
    )
    expect(terminalCommandForKey(key('KeyW', { meta: true }), 'darwin')).toBe('close-pane')
    expect(terminalCommandForKey(key('KeyD', { ctrl: true, shift: true }), 'darwin')).toBeNull()
  })
})
