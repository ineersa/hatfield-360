import { describe, expect, it } from 'vitest'
import {
  APP_COMMANDS,
  appShortcut,
  EDITOR_KEYMAP,
  editorShortcut,
  shellKeymap,
  terminalShortcut
} from '../../../shared/keymap'
import { TERMINAL_COMMANDS } from '../../../shared/terminal-api'
import { appCommandForKey, terminalCommandForKey } from './keymap-match'
import { parseShortcut, shortcutLabel } from './shortcut-keys'

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

describe('terminalCommandForKey', () => {
  it('reads the Linux shortcuts', () => {
    expect(
      terminalCommandForKey(key('KeyD', { ctrl: true, shift: true }), shellKeymap('linux'))
    ).toBe('split-right')
    expect(
      terminalCommandForKey(key('KeyD', { alt: true, shift: true }), shellKeymap('linux'))
    ).toBe('split-down')
    expect(
      terminalCommandForKey(key('KeyW', { ctrl: true, shift: true }), shellKeymap('linux'))
    ).toBe('close-pane')
    expect(
      terminalCommandForKey(key('BracketRight', { ctrl: true, shift: true }), shellKeymap('linux'))
    ).toBe('focus-next-pane')
    expect(terminalCommandForKey(key('PageUp', { ctrl: true }), shellKeymap('linux'))).toBe(
      'previous-tab'
    )
  })

  it("leaves the shell's own Ctrl keys alone", () => {
    for (const code of ['KeyD', 'KeyW', 'KeyT', 'BracketRight']) {
      expect(terminalCommandForKey(key(code, { ctrl: true }), shellKeymap('linux'))).toBeNull()
    }
  })

  it('reads the macOS Command shortcuts and not their Linux forms', () => {
    expect(terminalCommandForKey(key('KeyD', { meta: true }), shellKeymap('darwin'))).toBe(
      'split-right'
    )
    expect(
      terminalCommandForKey(key('KeyD', { meta: true, shift: true }), shellKeymap('darwin'))
    ).toBe('split-down')
    expect(terminalCommandForKey(key('KeyW', { meta: true }), shellKeymap('darwin'))).toBe(
      'close-pane'
    )
    expect(
      terminalCommandForKey(key('KeyD', { ctrl: true, shift: true }), shellKeymap('darwin'))
    ).toBeNull()
  })
})

describe('appCommandForKey', () => {
  it('copies the absolute path with Ctrl+Shift+C and the relative one with Alt added', () => {
    expect(appCommandForKey(key('KeyC', { ctrl: true, shift: true }), shellKeymap('linux'))).toBe(
      'copy-absolute-path'
    )
    expect(
      appCommandForKey(key('KeyC', { ctrl: true, shift: true, alt: true }), shellKeymap('linux'))
    ).toBe('copy-relative-path')
    expect(appCommandForKey(key('KeyC', { meta: true, shift: true }), shellKeymap('darwin'))).toBe(
      'copy-absolute-path'
    )
    expect(
      appCommandForKey(key('KeyC', { ctrl: true, shift: true }), shellKeymap('darwin'))
    ).toBeNull()
    expect(appCommandForKey(key('KeyC', { ctrl: true }), shellKeymap('linux'))).toBeNull()
  })

  it('reads keys with arrows and function keys', () => {
    expect(appCommandForKey(key('ArrowRight', { alt: true }), shellKeymap('linux'))).toBe(
      'next-editor-tab'
    )
    expect(appCommandForKey(key('F4', { ctrl: true }), shellKeymap('linux'))).toBe(
      'close-editor-tab'
    )
    expect(appCommandForKey(key('KeyW', { meta: true }), shellKeymap('darwin'))).toBe(
      'close-editor-tab'
    )
  })
})

describe('shortcuts', () => {
  it('reads every key in the keymap', () => {
    const accelerators = ['darwin', 'linux'].flatMap((platform) => [
      ...EDITOR_KEYMAP.map((binding) => editorShortcut(binding, platform)),
      ...APP_COMMANDS.map((command) => appShortcut(shellKeymap(platform), command)),
      ...TERMINAL_COMMANDS.map((command) => terminalShortcut(shellKeymap(platform), command))
    ])
    const unreadable = accelerators.filter((accelerator) => {
      try {
        if (accelerator !== null) parseShortcut(accelerator)
        return false
      } catch {
        return true
      }
    })
    expect(accelerators.length).toBeGreaterThan(100)
    expect(unreadable).toEqual([])
  })

  it('labels macOS keys with symbols in Apple’s order', () => {
    expect(shortcutLabel('Command+Alt+Shift+C', 'darwin')).toBe('⌥⇧⌘C')
    expect(shortcutLabel('Ctrl+Command+G', 'darwin')).toBe('⌃⌘G')
    expect(shortcutLabel('Ctrl+Alt+Shift+C', 'linux')).toBe('Ctrl+Alt+Shift+C')
  })
})
