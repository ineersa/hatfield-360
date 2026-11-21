import { describe, expect, it } from 'vitest'
import type { EditorScheme } from '../../../../shared/themes/editor-scheme'
import { monacoTheme } from './monaco-theme'

// Loaded as the app loads them, typed as schemes.
const SCHEMES = import.meta.glob<EditorScheme>('../../assets/themes/editor/*.json', {
  import: 'default',
  eager: true
})

function scheme(id: string): EditorScheme {
  const loaded = SCHEMES[`../../assets/themes/editor/${id}.json`]
  if (!loaded) throw new Error(`No editor scheme ${id}`)
  return loaded
}

const islandsDark = scheme('islands-dark')
const light = scheme('light')

const rule = (source: EditorScheme, token: string) =>
  monacoTheme(source).rules.find((candidate) => candidate.token === token)

describe('Monaco themes from editor schemes', () => {
  it('take token colours and styles from the scheme', () => {
    expect(rule(islandsDark, '')).toMatchObject({ foreground: 'bcbec4', fontStyle: '' })
    expect(rule(islandsDark, 'keyword')).toMatchObject({ foreground: 'cf8e6d' })
    expect(rule(islandsDark, 'comment')).toMatchObject({ foreground: '7a7e85' })
  })

  it('fall back to a more general key, then to plain text, so Monaco colours never show', () => {
    // Light sets no colour for braces or class names: they are drawn as plain text.
    expect(light.attributes).not.toHaveProperty('DEFAULT_BRACES')
    expect(rule(light, 'delimiter.bracket')?.foreground).toBe('080808')
    // JSON keys have no colour of their own in Islands Dark; they are drawn as fields.
    expect(rule(islandsDark, 'string.key.json')?.foreground).toBe(
      islandsDark.attributes.DEFAULT_INSTANCE_FIELD?.foreground?.slice(1)
    )
  })

  it('take the editor colours from the scheme and its light or dark base', () => {
    const dark = monacoTheme(islandsDark)
    expect(dark.base).toBe('vs-dark')
    expect(dark.colors).toMatchObject({
      'editor.background': islandsDark.attributes.TEXT?.background,
      'editor.foreground': islandsDark.attributes.TEXT?.foreground,
      'editor.lineHighlightBackground': islandsDark.colors.CARET_ROW_COLOR,
      'editorLineNumber.foreground': islandsDark.colors.LINE_NUMBERS_COLOR
    })
    expect(monacoTheme(light).base).toBe('vs')
  })

  it('give Monaco token colours without the # or the alpha', () => {
    const colours = monacoTheme(islandsDark).rules.flatMap((entry) =>
      entry.foreground === undefined ? [] : [entry.foreground]
    )
    expect(colours).not.toHaveLength(0)
    expect(colours.filter((colour) => !/^[0-9a-f]{6}$/.test(colour))).toEqual([])
  })
})
