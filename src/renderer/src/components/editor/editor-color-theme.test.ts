import { describe, expect, it } from 'vitest'
import type { EditorScheme } from '../../../../shared/themes/editor-scheme'
import { editorColorTheme, type MenuColors } from './editor-color-theme'

// Loaded as the app loads them, typed as schemes.
const SCHEMES = import.meta.glob<EditorScheme>('../../assets/themes/editor/*.json', {
  import: 'default',
  eager: true
})

function loadScheme(id: string): EditorScheme {
  const loaded = SCHEMES[`../../assets/themes/editor/${id}.json`]
  if (!loaded) throw new Error(`No editor scheme ${id}`)
  return loaded
}

const darcula = loadScheme('darcula')
const light = loadScheme('light')

const menu: MenuColors = {
  background: 'menu-background',
  foreground: 'menu-foreground',
  border: 'menu-border',
  selection: 'menu-selection',
  selectionForeground: 'menu-selection-foreground',
  separator: 'menu-separator'
}

const rule = (from: EditorScheme, scope: string) =>
  editorColorTheme(from, menu).tokenColors.find((token) => token.scope?.includes(scope))?.settings

// Expected colours are the schemes' own, read from the files the app ships.
const text = darcula.attributes['TEXT'] ?? {}

describe('editorColorTheme', () => {
  it("takes the editor's colours from the scheme and the menu's from the app theme", () => {
    const theme = editorColorTheme(darcula, menu)
    expect(theme.type).toBe('dark')
    expect(theme.colors).toMatchObject({
      'editor.background': text.background,
      'editor.foreground': text.foreground,
      'editorCursor.foreground': darcula.colors['CARET_COLOR'],
      'editorError.foreground': darcula.attributes['ERRORS_ATTRIBUTES']?.effect?.color,
      'menu.background': 'menu-background'
    })
    expect(editorColorTheme(light, menu).type).toBe('light')
  })

  it("colours scopes with the scheme's keys, keeping their style and clearing a parent's", () => {
    expect(rule(darcula, 'keyword')).toEqual({
      fontStyle: '',
      foreground: darcula.attributes['DEFAULT_KEYWORD']?.foreground
    })
    expect(rule(light, 'comment')).toEqual({
      fontStyle: 'italic',
      foreground: light.attributes['DEFAULT_LINE_COMMENT']?.foreground
    })
    // Darcula sets no operator colour: operators are drawn as plain text, as in the IDE.
    expect(rule(darcula, 'keyword.operator')).toEqual({
      fontStyle: '',
      foreground: text.foreground
    })
  })

  it('makes Markdown bold in a scheme without Markdown colours, in the text colour', () => {
    expect(rule(darcula, 'markup.bold')).toEqual({ fontStyle: 'bold', foreground: text.foreground })
  })

  it("gives every scope a colour in every shipped scheme, so none of VS Code's shows through", () => {
    expect(Object.keys(SCHEMES)).toHaveLength(12)
    const uncoloured = Object.values(SCHEMES).flatMap((shipped) =>
      editorColorTheme(shipped, menu)
        .tokenColors.filter((token) => token.settings.foreground === undefined)
        .map((token) => `${shipped.name}: ${token.scope?.join(', ') ?? 'text'}`)
    )
    expect(uncoloured).toEqual([])
  })
})
