import { describe, expect, it } from 'vitest'
import { keybindingsTemplate } from '../../shared/keybindings-template'
import { parseKeybindings } from './keybindings-document'

describe('parseKeybindings', () => {
  it('reads entries with comments and trailing commas', () => {
    const text = `// mine
[
  { "key": "ctrl+e", "command": "editor.action.duplicateSelection", "when": "editorTextFocus" },
  { "key": "ctrl+d", "command": "-editor.action.duplicateSelection" },
  { "command": "-hatfield.save" },
  { "key": "alt+down", "command": "cursorMove", "args": { "to": "down" } },
]`
    expect(parseKeybindings(text, 'linux')).toEqual({
      entries: [
        { key: 'ctrl+e', command: 'editor.action.duplicateSelection', when: 'editorTextFocus' },
        { key: 'ctrl+d', command: '-editor.action.duplicateSelection' },
        { key: null, command: '-hatfield.save' },
        { key: 'alt+down', command: 'cursorMove', args: { to: 'down' } }
      ],
      problems: []
    })
  })

  it('leaves out bad entries and says why', () => {
    const text = `[
  { "key": "ctrl+e" },
  { "command": "editor.action.duplicateSelection" },
  { "key": "hyper+e", "command": "editor.action.duplicateSelection" },
  { "key": "ctrl+e", "command": "hatfield.nothing" },
  { "key": "ctrl+k ctrl+w", "command": "hatfield.editor.closeTab" },
  "ctrl+e",
  { "key": "ctrl+alt+w", "command": "hatfield.editor.closeTab", "when": "editorTextFocus" },
  { "key": "ctrl+e", "command": "hatfield.openFolder" }
]`
    expect(parseKeybindings(text, 'linux')).toEqual({
      entries: [{ key: 'ctrl+e', command: 'hatfield.openFolder' }],
      problems: [
        'Entry 1 needs a "command"; it is ignored.',
        'Entry 2 needs a "key"; it is ignored.',
        `Entry 3 has a key the app can't read: "hyper+e"; it is ignored.`,
        "Entry 4 runs hatfield.nothing, which isn't a Hatfield 360 command; it is ignored.",
        'Entry 5 binds hatfield.editor.closeTab to two chords; app and terminal keys are one chord; it is ignored.',
        'Entry 6 must be an object; it is ignored.',
        `Entry 7 gives hatfield.editor.closeTab a "when"; app and terminal keys can't have one; it is ignored.`
      ]
    })
  })

  it.each(['linux', 'darwin'])(
    'takes every default in the %s template once uncommented',
    (platform) => {
      const lines = keybindingsTemplate(platform).split('\n')
      const uncommented = lines.map((line) => line.replace(/^  \/\/ \{/, '  {'))
      const parsed = parseKeybindings(uncommented.join('\n'), platform)
      expect(parsed.problems).toEqual([])
      expect(parsed.entries).toHaveLength(lines.filter((line) => line.startsWith('  // { ')).length)
    }
  )

  it('keeps nothing from a file that is not a list, so the last good keys stay', () => {
    expect(parseKeybindings('[ { "key": ', 'linux').entries).toBeNull()
    expect(parseKeybindings('{}', 'linux')).toEqual({
      entries: null,
      problems: ['keybindings.json must be a list of entries; keeping the previous keys.']
    })
    expect(parseKeybindings('', 'linux')).toEqual({ entries: [], problems: [] })
  })
})
