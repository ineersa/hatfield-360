import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from '../../shared/settings-api'
import { parseSettings } from './settings-document'

const lastGood: Settings = {
  ...DEFAULT_SETTINGS,
  'app.fontSize': 16,
  'editor.fontFamily': 'Fira Code',
  'workbench.iconTheme': 'lucide'
}

describe('parseSettings', () => {
  it('uses defaults for an empty file and for keys the file leaves out', () => {
    expect(parseSettings('', lastGood)).toEqual({ values: DEFAULT_SETTINGS, problems: [] })
    expect(parseSettings('{ "app.fontSize": 15 }', lastGood)).toEqual({
      values: { ...DEFAULT_SETTINGS, 'app.fontSize': 15 },
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
      problems: []
    })
  })

  it('keeps the last good settings when the file is not valid JSON or not an object', () => {
    expect(parseSettings('{\n  "app.fontSize": 15\n  "editor.fontSize": 14\n}', lastGood)).toEqual({
      values: lastGood,
      problems: [
        'settings.json is not valid JSON (line 3: comma expected); keeping the previous settings.'
      ]
    })
    expect(parseSettings('[1, 2]', lastGood)).toEqual({
      values: lastGood,
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
})
