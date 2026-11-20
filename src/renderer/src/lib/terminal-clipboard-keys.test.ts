import { describe, expect, it } from 'vitest'
import { terminalClipboardAction } from './terminal-clipboard-keys'

const key = (
  code: string,
  modifiers: { ctrl?: boolean; shift?: boolean; meta?: boolean } = {}
) => ({
  code,
  ctrlKey: modifiers.ctrl ?? false,
  shiftKey: modifiers.shift ?? false,
  altKey: false,
  metaKey: modifiers.meta ?? false
})

describe('terminalClipboardAction', () => {
  it('pastes with Ctrl+V and Shift+Insert, and leaves Ctrl+Shift+V to the program as ^V', () => {
    expect(terminalClipboardAction(key('KeyV', { ctrl: true }), 'linux', false)).toBe('paste')
    expect(terminalClipboardAction(key('Insert', { shift: true }), 'linux', false)).toBe('paste')
    expect(terminalClipboardAction(key('KeyV', { ctrl: true, shift: true }), 'win32', false)).toBe(
      'app-paste'
    )
  })

  it('copies a selection with Ctrl+C, and leaves Ctrl+C to interrupt the shell without one', () => {
    expect(terminalClipboardAction(key('KeyC', { ctrl: true }), 'linux', true)).toBe('copy')
    expect(terminalClipboardAction(key('KeyC', { ctrl: true }), 'linux', false)).toBeNull()
    expect(terminalClipboardAction(key('KeyC', { ctrl: true, shift: true }), 'linux', false)).toBe(
      'ignore'
    )
  })

  it('leaves every Control key to the shell on macOS, where the clipboard is on Command', () => {
    expect(terminalClipboardAction(key('KeyV', { ctrl: true }), 'darwin', false)).toBeNull()
    expect(terminalClipboardAction(key('KeyC', { ctrl: true }), 'darwin', true)).toBeNull()
  })
})
