import { parse } from 'jsonc-parser'
import { describe, expect, it } from 'vitest'
import { keybindingsTemplate } from './keybindings-template'
import { EDITOR_KEYMAP, editorShortcut, shellActions } from './keymap'

describe('keybindingsTemplate', () => {
  it('is an empty list, with every default key written out in comments', () => {
    const text = keybindingsTemplate('linux')
    expect(parse(text)).toEqual([])
    expect(text).toContain(
      '  // { "key": "ctrl+d", "command": "editor.action.duplicateSelection", "when": "editorTextFocus && !editorReadonly" }, // EditorDuplicate'
    )
    expect(text).toContain(
      '  // { "key": "ctrl+shift+d", "command": "hatfield.terminal.splitRight" }, // Split Right'
    )
    expect(text).toContain('"command": "hatfield.editor.closeTab" }, // Close Tab')
    const commented = text.split('\n').filter((line) => line.startsWith('  // { '))
    const keyed = EDITOR_KEYMAP.filter((binding) => editorShortcut(binding, 'linux') !== null)
    const shell = shellActions('linux').filter((action) => action.key !== null)
    expect(commented).toHaveLength(keyed.length + shell.length)
  })

  it('reads as entries once a line is uncommented', () => {
    const text = keybindingsTemplate('darwin').replace(
      '  // { "key": "cmd+d", "command": "hatfield.terminal.splitRight" },',
      '  { "key": "cmd+d", "command": "hatfield.terminal.splitRight" },'
    )
    expect(parse(text, [], { allowTrailingComma: true })).toEqual([
      { key: 'cmd+d', command: 'hatfield.terminal.splitRight' }
    ])
  })
})
