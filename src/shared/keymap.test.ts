import { describe, expect, it } from 'vitest'
import {
  APP_COMMANDS,
  appShortcut,
  EDITOR_KEYMAP,
  editorShortcut,
  shellKeymap,
  terminalShortcut
} from './keymap'
import { TERMINAL_COMMANDS } from './terminal-api'

const PLATFORMS = ['darwin', 'linux'] as const

const editorKey = (action: string, platform: string): string | null => {
  const binding = EDITOR_KEYMAP.find((each) => each.action === action)
  if (!binding) throw new Error(`No ${action} in the editor keymap`)
  return editorShortcut(binding, platform)
}

/** Keys that appear more than once in a list (`null` keys left out). */
const repeated = (keys: (string | null)[]): string[] =>
  keys.filter((key, index): key is string => key !== null && keys.indexOf(key) !== index)

describe('keymap', () => {
  it('has the JetBrains editor keys for Linux and macOS', () => {
    const expected: [string, string, string][] = [
      ['EditorDuplicate', 'Ctrl+D', 'Command+D'],
      ['EditorDeleteLine', 'Ctrl+Y', 'Command+Backspace'],
      ['CommentByLineComment', 'Ctrl+/', 'Command+/'],
      ['CommentByBlockComment', 'Ctrl+Shift+/', 'Command+Alt+/'],
      ['EditorSelectWord', 'Ctrl+W', 'Alt+Up'],
      ['EditorUnSelectWord', 'Ctrl+Shift+W', 'Alt+Down'],
      ['MoveLineDown', 'Alt+Shift+Down', 'Alt+Shift+Down'],
      ['MoveStatementUp', 'Ctrl+Shift+Up', 'Command+Shift+Up'],
      ['GotoDeclaration', 'Ctrl+B', 'Command+B'],
      ['GotoImplementation', 'Ctrl+Alt+B', 'Command+Alt+B'],
      ['GotoTypeDeclaration', 'Ctrl+Shift+B', 'Command+Shift+B'],
      ['FindUsages', 'Alt+F7', 'Alt+F7'],
      ['QuickJavaDoc', 'Ctrl+Q', 'F1'],
      ['ParameterInfo', 'Ctrl+P', 'Command+P'],
      ['GotoLine', 'Ctrl+G', 'Command+L'],
      ['ReformatCode', 'Ctrl+Alt+L', 'Command+Alt+L'],
      ['RenameElement', 'Shift+F6', 'Shift+F6'],
      ['GotoNextError', 'F2', 'F2'],
      ['GotoPreviousError', 'Shift+F2', 'Shift+F2'],
      ['SelectNextOccurrence', 'Alt+J', 'Ctrl+G'],
      ['SelectAllOccurrences', 'Ctrl+Alt+Shift+J', 'Ctrl+Command+G'],
      ['CodeCompletion', 'Ctrl+Space', 'Ctrl+Space'],
      ['SmartTypeCompletion', 'Ctrl+Shift+Space', 'Ctrl+Shift+Space']
    ]
    for (const [action, linux, mac] of expected) {
      expect([action, editorKey(action, 'linux'), editorKey(action, 'darwin')]).toEqual([
        action,
        linux,
        mac
      ])
    }
  })

  it('binds each editor key once per platform, except one action split by context', () => {
    for (const platform of PLATFORMS) {
      const keys = EDITOR_KEYMAP.map((binding) => editorShortcut(binding, platform))
      const shared = repeated(keys).flatMap((key) =>
        EDITOR_KEYMAP.filter((binding) => editorShortcut(binding, platform) === key).map(
          (binding) => binding.action
        )
      )
      expect(new Set(shared)).toEqual(new Set(['ReformatCode']))
    }
  })

  it('binds each app and terminal key once per platform', () => {
    for (const platform of PLATFORMS) {
      expect(
        repeated(APP_COMMANDS.map((command) => appShortcut(shellKeymap(platform), command)))
      ).toEqual([])
      expect(
        repeated(
          TERMINAL_COMMANDS.map((command) => terminalShortcut(shellKeymap(platform), command))
        )
      ).toEqual([])
    }
  })

  it('leaves Ctrl+letter to the shell on Linux, but for the menu keys a focused terminal keeps', () => {
    const plainCtrl = /^Ctrl\+[A-Z]$/
    const terminal = TERMINAL_COMMANDS.map((command) =>
      terminalShortcut(shellKeymap('linux'), command)
    )
    const app = APP_COMMANDS.map((command) => appShortcut(shellKeymap('linux'), command))
    expect(terminal.filter((key) => key !== null && plainCtrl.test(key))).toEqual([])
    // Search Memory takes Ctrl+K (kill-line) on purpose: it opens over a focused terminal.
    expect(app.filter((key) => key !== null && plainCtrl.test(key))).toEqual([
      'Ctrl+O',
      'Ctrl+S',
      'Ctrl+N',
      'Ctrl+K'
    ])
  })

  it('has app keys after JetBrains', () => {
    expect(appShortcut(shellKeymap('linux'), 'settings')).toBe('Ctrl+Alt+S')
    expect(appShortcut(shellKeymap('darwin'), 'settings')).toBe('Command+,')
    expect(appShortcut(shellKeymap('linux'), 'close-editor-tab')).toBe('Ctrl+F4')
    expect(appShortcut(shellKeymap('darwin'), 'close-editor-tab')).toBe('Command+W')
    expect(appShortcut(shellKeymap('linux'), 'next-editor-tab')).toBe('Alt+Right')
    expect(appShortcut(shellKeymap('darwin'), 'previous-editor-tab')).toBe('Command+Shift+[')
    expect(appShortcut(shellKeymap('linux'), 'close-window')).toBeNull()
    expect(appShortcut(shellKeymap('linux'), 'go-to-file')).toBe('Ctrl+Shift+N')
    expect(appShortcut(shellKeymap('darwin'), 'go-to-class')).toBe('Command+O')
    expect(appShortcut(shellKeymap('darwin'), 'open-folder')).toBeNull()
  })
})

describe('shellKeymap', () => {
  it('adds a key to a command, which then shows that key', () => {
    const keymap = shellKeymap('linux', [{ key: 'ctrl+w', command: 'hatfield.editor.closeTab' }])
    expect(appShortcut(keymap, 'close-editor-tab')).toBe('Ctrl+W')
    // The default key still runs it until removed.
    expect(keymap.filter((binding) => binding.command === 'close-editor-tab')).toHaveLength(2)
  })

  it('moves a key to the command bound last, so menu and key handler agree', () => {
    const keymap = shellKeymap('linux', [{ key: 'ctrl+o', command: 'hatfield.settings' }])
    expect(keymap.filter((binding) => binding.key === 'Ctrl+O')).toEqual([
      { kind: 'app', command: 'settings', key: 'Ctrl+O' }
    ])
    expect(appShortcut(keymap, 'open-folder')).toBeNull()
    // A terminal command on an app key keeps both: they never act on the same view.
    const shared = shellKeymap('linux', [
      { key: 'ctrl+o', command: 'hatfield.terminal.splitRight' }
    ])
    expect(appShortcut(shared, 'open-folder')).toBe('Ctrl+O')
    expect(terminalShortcut(shared, 'split-right')).toBe('Ctrl+O')
  })

  it('removes one default key, or all of a command with no key', () => {
    const one = shellKeymap('linux', [
      { key: 'shift+ctrl+d', command: '-hatfield.terminal.splitRight' }
    ])
    expect(terminalShortcut(one, 'split-right')).toBeNull()
    const all = shellKeymap('darwin', [{ key: null, command: '-hatfield.save' }])
    expect(appShortcut(all, 'save')).toBeNull()
    expect(appShortcut(all, 'settings')).toBe('Command+,')
  })

  it('leaves out editor commands, unknown ids and two-chord keys', () => {
    const keymap = shellKeymap('linux', [
      { key: 'ctrl+e', command: 'editor.action.duplicateSelection' },
      { key: 'ctrl+e', command: 'hatfield.nothing' },
      { key: 'ctrl+k ctrl+w', command: 'hatfield.editor.closeTab' }
    ])
    expect(keymap).toEqual(shellKeymap('linux'))
  })
})
