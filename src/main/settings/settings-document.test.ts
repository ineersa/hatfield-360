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
      "editor.fontFamily": "Fira Code",
      "editor.fontSize": 15,
      "workbench.iconTheme": "lucide",
    }`
    expect(parseSettings(text, DEFAULT_SETTINGS)).toEqual({
      values: {
        'app.fontFamily': 'Noto Sans',
        'app.fontSize': 12.5,
        'terminal.fontFamily': "'Iosevka Term', monospace",
        'terminal.fontSize': 14,
        'editor.fontFamily': 'Fira Code',
        'editor.fontSize': 15,
        'workbench.iconTheme': 'lucide'
      },
      customized: [
        'app.fontFamily',
        'app.fontSize',
        'terminal.fontFamily',
        'terminal.fontSize',
        'editor.fontFamily',
        'editor.fontSize',
        'workbench.iconTheme'
      ],
      editable: true,
      problems: []
    })
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

  it('clamps font sizes and keeps the last good value for wrong values, naming each problem', () => {
    const text = JSON.stringify({
      'app.fontSize': 'big',
      'terminal.fontSize': 4,
      'editor.fontSize': 40,
      'editor.fontFamily': '',
      'app.fontFamily': 'Inter; color: red',
      'workbench.iconTheme': 'material',
      'app.fontsize': 15
    })
    expect(parseSettings(text, lastGood)).toEqual({
      values: {
        ...DEFAULT_SETTINGS,
        'app.fontSize': 16,
        'terminal.fontSize': 8,
        'editor.fontSize': 32,
        'editor.fontFamily': 'Fira Code',
        'workbench.iconTheme': 'lucide'
      },
      customized: [
        'app.fontSize',
        'terminal.fontSize',
        'editor.fontSize',
        'editor.fontFamily',
        'app.fontFamily',
        'workbench.iconTheme'
      ],
      editable: true,
      problems: [
        '"app.fontSize" must be a number.',
        '"terminal.fontSize" must be between 8 and 32; using 8.',
        '"editor.fontSize" must be between 8 and 32; using 32.',
        '"editor.fontFamily" must be a font name.',
        '"app.fontFamily" must not contain ; { or }.',
        '"workbench.iconTheme" must be one of "catppuccin", "lucide".',
        'Unknown setting "app.fontsize".'
      ]
    })
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
