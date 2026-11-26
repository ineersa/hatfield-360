import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from '../../shared/settings-api'
import { parseSettings, withSetting } from './settings-document'

const lastGood: Settings = {
  ...DEFAULT_SETTINGS,
  'app.fontSize': 16,
  'editor.fontFamily': 'Fira Code',
  'workbench.iconTheme': 'lucide'
}

describe('parseSettings', () => {
  it('uses defaults for an empty file and for keys the file leaves out', () => {
    expect(parseSettings('', lastGood)).toEqual({
      values: DEFAULT_SETTINGS,
      customized: [],
      editable: true,
      problems: []
    })
    expect(parseSettings('{ "app.fontSize": 15 }', lastGood)).toEqual({
      values: { ...DEFAULT_SETTINGS, 'app.fontSize': 15 },
      customized: ['app.fontSize'],
      editable: true,
      problems: []
    })
  })

  it('reads every setting, with comments and trailing commas', () => {
    const text = `{
      // Like VS Code
      "app.fontFamily": " Noto Sans ",
      "app.fontSize": 12.5,
      "terminal.fontFamily": "'Iosevka Term', monospace",
      "terminal.fontSize": 14,
      "terminal.lineHeight": 1.5,
      "terminal.gpuAcceleration": false,
      "editor.fontFamily": "Fira Code",
      "editor.fontSize": 15,
      "editor.lineHeight": 1.4,
      "workbench.iconTheme": "lucide",
      "workbench.colorTheme": "islands-catppuccin-mocha",
      "editor.colorTheme": "catppuccin-mocha-no-italics",
      "terminal.colorTheme": "catppuccin-mocha",
    }`
    expect(parseSettings(text, DEFAULT_SETTINGS)).toEqual({
      values: {
        ...DEFAULT_SETTINGS,
        'app.fontFamily': 'Noto Sans',
        'app.fontSize': 12.5,
        'terminal.fontFamily': "'Iosevka Term', monospace",
        'terminal.fontSize': 14,
        'terminal.lineHeight': 1.5,
        'terminal.gpuAcceleration': false,
        'editor.fontFamily': 'Fira Code',
        'editor.fontSize': 15,
        'editor.lineHeight': 1.4,
        'workbench.iconTheme': 'lucide',
        'workbench.colorTheme': 'islands-catppuccin-mocha',
        'editor.colorTheme': 'catppuccin-mocha-no-italics',
        'terminal.colorTheme': 'catppuccin-mocha'
      },
      customized: [
        'app.fontFamily',
        'app.fontSize',
        'terminal.fontFamily',
        'terminal.fontSize',
        'terminal.lineHeight',
        'terminal.gpuAcceleration',
        'editor.fontFamily',
        'editor.fontSize',
        'editor.lineHeight',
        'workbench.iconTheme',
        'workbench.colorTheme',
        'editor.colorTheme',
        'terminal.colorTheme'
      ],
      editable: true,
      problems: []
    })
  })

  it('reads a launch profile from JSON with comments and trailing commas', () => {
    const text = `{
      // Keep launches wrapped by the sandbox.
      "agents.hatfield": { "executable": "  hatfield-safe  ", "args": ["--label", " local dev "], },
    }`
    const parsed = parseSettings(text, lastGood)
    expect(parsed.values['agents.hatfield']).toEqual({
      executable: 'hatfield-safe',
      args: ['--label', ' local dev ']
    })
    expect(parsed.problems).toEqual([])
  })

  it('keeps the last good settings when the file is not valid JSON or not an object', () => {
    expect(parseSettings('{\n  "app.fontSize": 15\n  "editor.fontSize": 14\n}', lastGood)).toEqual({
      values: lastGood,
      customized: [],
      editable: false,
      problems: [
        'settings.json is not valid JSON (line 3: comma expected); keeping the previous settings.'
      ]
    })
    expect(parseSettings('[1, 2]', lastGood)).toEqual({
      values: lastGood,
      customized: [],
      editable: false,
      problems: ['settings.json must be a JSON object; keeping the previous settings.']
    })
  })

  it('clamps font sizes and line heights and keeps the last good value for wrong values, naming each problem', () => {
    const text = JSON.stringify({
      'app.fontSize': 'big',
      'terminal.fontSize': 4,
      'editor.fontSize': 40,
      'editor.lineHeight': 0.5,
      'terminal.lineHeight': '1.5',
      'editor.fontFamily': '',
      'app.fontFamily': 'Inter; color: red',
      'workbench.iconTheme': 'material',
      'terminal.gpuAcceleration': 'off',
      'workbench.colorTheme': 'Islands Dark',
      'app.fontsize': 15
    })
    expect(parseSettings(text, lastGood)).toEqual({
      values: {
        ...DEFAULT_SETTINGS,
        'app.fontSize': 16,
        'terminal.fontSize': 8,
        'editor.fontSize': 32,
        'editor.lineHeight': 1,
        'editor.fontFamily': 'Fira Code',
        'workbench.iconTheme': 'lucide'
      },
      customized: [
        'app.fontSize',
        'terminal.fontSize',
        'editor.fontSize',
        'editor.lineHeight',
        'terminal.lineHeight',
        'editor.fontFamily',
        'app.fontFamily',
        'workbench.iconTheme',
        'terminal.gpuAcceleration',
        'workbench.colorTheme'
      ],
      editable: true,
      problems: [
        '"app.fontSize" must be a number.',
        '"terminal.fontSize" must be between 8 and 32; using 8.',
        '"editor.fontSize" must be between 8 and 32; using 32.',
        '"editor.lineHeight" must be between 1 and 2; using 1.',
        '"terminal.lineHeight" must be a number.',
        '"editor.fontFamily" must be a font name.',
        '"app.fontFamily" must not contain ; { or }.',
        '"workbench.iconTheme" must be one of "catppuccin", "lucide".',
        '"terminal.gpuAcceleration" must be true or false.',
        '"workbench.colorTheme" must be one of "high-contrast", "islands-catppuccin-frappe", "islands-catppuccin-latte", "islands-catppuccin-macchiato", "islands-catppuccin-mocha", "islands-darcula", "islands-dark", "islands-light".',
        'Unknown setting "app.fontsize".'
      ]
    })
  })

  it('accepts a Librarian endpoint and token variable, and rejects credentials, queries and non-HTTP URLs', () => {
    const good = parseSettings(
      `{
        "memory.librarianUrl": " https://librarian.internal:8093/_mcp ",
        "memory.librarianTokenVariable": "LIBRARIAN_TOKEN",
        "memory.librarianTimeoutSeconds": 10
      }`,
      DEFAULT_SETTINGS
    )
    expect(good.problems).toEqual([])
    expect(good.values['memory.librarianUrl']).toBe('https://librarian.internal:8093/_mcp')
    expect(good.values['memory.librarianTokenVariable']).toBe('LIBRARIAN_TOKEN')
    expect(good.values['memory.librarianTimeoutSeconds']).toBe(10)

    const bad = parseSettings(
      `{
        "memory.librarianUrl": "http://user:secret@127.0.0.1:8093/_mcp?project=x",
        "memory.librarianTokenVariable": "env:LIBRARIAN_TOKEN",
        "memory.librarianTimeoutSeconds": 2.5
      }`,
      DEFAULT_SETTINGS
    )
    expect(bad.values['memory.librarianUrl']).toBe('http://127.0.0.1:8093/_mcp')
    expect(bad.values['memory.librarianTokenVariable']).toBe('')
    expect(bad.values['memory.librarianTimeoutSeconds']).toBe(30)
    expect(bad.problems).toEqual([
      '"memory.librarianUrl" must be an absolute http(s) URL without credentials, query or fragment.',
      '"memory.librarianTokenVariable" must be an environment variable name, such as "LIBRARIAN_TOKEN", or empty.',
      '"memory.librarianTimeoutSeconds" must be a whole number of seconds.'
    ])
    expect(
      parseSettings('{ "memory.librarianUrl": "ftp://host/_mcp" }', DEFAULT_SETTINGS).problems
    ).toHaveLength(1)
  })

  it('locks page edits when a key is set twice, using the last value like JSON does', () => {
    expect(
      parseSettings('{ "app.fontSize": 16, "editor.fontSize": 15, "app.fontSize": 20 }', lastGood)
    ).toEqual({
      values: { ...DEFAULT_SETTINGS, 'app.fontSize': 20, 'editor.fontSize': 15 },
      customized: ['app.fontSize', 'editor.fontSize'],
      editable: false,
      problems: ['"app.fontSize" is set more than once; the last one is used. Remove the others.']
    })
  })
})

describe('withSetting', () => {
  const file = `{
  // My fonts
  "app.fontFamily": "Noto Sans",
  "app.fontSize": 16,
}
`

  it('removes a saved profile when independently entered values match the default', () => {
    const custom = '{ "agents.hatfield": { "executable": "hatfield-safe", "args": [] } }'
    const updated = withSetting(custom, 'agents.hatfield', { executable: 'hatfield', args: [] })
    expect(updated).not.toContain('agents.hatfield')
  })

  it('keeps literal arguments, in order, when saving the default executable', () => {
    const updated = withSetting('{}', 'agents.claude', {
      executable: 'claude',
      args: ['--flag', ' literal ']
    })
    expect(updated).toContain('"agents.claude"')
    expect(parseSettings(updated, lastGood).values['agents.claude']).toEqual({
      executable: 'claude',
      args: ['--flag', ' literal ']
    })
  })

  it('changes one setting and keeps comments and the other settings', () => {
    expect(withSetting(file, 'app.fontSize', 18)).toBe(`{
  // My fonts
  "app.fontFamily": "Noto Sans",
  "app.fontSize": 18,
}
`)
    expect(withSetting(file, 'workbench.iconTheme', 'lucide')).toBe(`{
  // My fonts
  "app.fontFamily": "Noto Sans",
  "app.fontSize": 16,
  "workbench.iconTheme": "lucide",
}
`)
  })

  it('removes a setting that is reset or set back to its default', () => {
    const expected = `{
  // My fonts
  "app.fontFamily": "Noto Sans",
}
`
    expect(withSetting(file, 'app.fontSize', null)).toBe(expected)
    expect(withSetting(file, 'app.fontSize', DEFAULT_SETTINGS['app.fontSize'])).toBe(expected)
  })

  it('starts an empty file as a JSON object', () => {
    expect(withSetting('', 'editor.fontSize', 15)).toBe('{\n  "editor.fontSize": 15\n}\n')
  })
})
