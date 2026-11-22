import type { languages } from 'monaco-editor'
import { describe, expect, it } from 'vitest'
import type { EditorScheme } from '../../../../shared/themes/editor-scheme'
import { markdownLanguage } from './markdown-tokens'
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

// Passed through as given: the app reads them from its theme's popup roles.
const MENU = {
  background: 'popover',
  foreground: 'popover-foreground',
  border: 'popover-border',
  selection: 'popover-selection',
  selectionForeground: 'popover-selection-foreground',
  separator: 'separator'
}

const islandsDark = scheme('islands-dark')
const light = scheme('light')

const rule = (source: EditorScheme, token: string) =>
  monacoTheme(source, MENU).rules.find((candidate) => candidate.token === token)

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
    const dark = monacoTheme(islandsDark, MENU)
    expect(dark.base).toBe('vs-dark')
    expect(dark.colors).toMatchObject({
      'editor.background': islandsDark.attributes.TEXT?.background,
      'editor.foreground': islandsDark.attributes.TEXT?.foreground,
      'editor.lineHighlightBackground': islandsDark.colors.CARET_ROW_COLOR,
      'editorLineNumber.foreground': islandsDark.colors.LINE_NUMBERS_COLOR
    })
    expect(monacoTheme(light, MENU).base).toBe('vs')
  })

  it('give the context menu the app theme popup colours', () => {
    expect(monacoTheme(islandsDark, MENU).colors).toMatchObject({
      'menu.background': MENU.background,
      'menu.selectionBackground': MENU.selection,
      'menu.separatorBackground': MENU.separator
    })
  })

  it('give Monaco token colours without the # or the alpha', () => {
    const colours = monacoTheme(islandsDark, MENU).rules.flatMap((entry) =>
      entry.foreground === undefined ? [] : [entry.foreground]
    )
    expect(colours).not.toHaveLength(0)
    expect(colours.filter((colour) => !/^[0-9a-f]{6}$/.test(colour))).toEqual([])
  })
})

// Monaco's Monarch languages; a few need a browser window to load and are left out below.
const LANGUAGES = import.meta.glob<{ language?: languages.IMonarchLanguage }>(
  '/node_modules/monaco-editor/esm/vs/languages/definitions/*/*.js'
)
const NEEDS_WINDOW = [
  'freemarker2',
  'handlebars',
  'html',
  'javascript',
  'liquid',
  'mdx',
  'python',
  'razor',
  'typescript',
  'xml',
  'yaml'
]

/** The token classes a rule's action gives, without states, groups or whitespace. */
function actionTokens(action: unknown, found: Set<string>): void {
  if (typeof action === 'string') {
    if (action !== '' && action !== 'white' && !action.startsWith('@') && !action.includes('$'))
      found.add(action)
  } else if (Array.isArray(action)) {
    for (const each of action) actionTokens(each, found)
  } else if (typeof action === 'object' && action !== null) {
    if ('token' in action) actionTokens(action.token, found)
    if ('cases' in action && typeof action.cases === 'object' && action.cases !== null)
      for (const each of Object.values(action.cases)) actionTokens(each, found)
  }
}

function languageTokens(language: languages.IMonarchLanguage, name: string): string[] {
  const found = new Set<string>()
  for (const rules of Object.values(language.tokenizer))
    for (const each of rules) {
      if (Array.isArray(each)) actionTokens(each[1], found)
      else if ('action' in each) actionTokens(each.action, found)
    }
  return [...found].map((token) => `${token}${language.tokenPostfix ?? `.${name}`}`)
}

describe('Monaco token classes', () => {
  it('all have a colour from the scheme, for every language Monaco highlights', async () => {
    const rules = monacoTheme(islandsDark, MENU)
      .rules.map((entry) => entry.token)
      .filter(Boolean)
    const covered = (token: string) =>
      rules.some((ruled) => token === ruled || token.startsWith(`${ruled}.`))
    const missing: string[] = []
    const failed: string[] = []
    const check = (language: languages.IMonarchLanguage, name: string) => {
      for (const token of languageTokens(language, name)) if (!covered(token)) missing.push(token)
    }
    for (const [path, load] of Object.entries(LANGUAGES)) {
      const name = /definitions\/([^/]+)\/\1\.js$/.exec(path)?.[1]
      // Monaco's Markdown is replaced by the app's.
      if (name === undefined || name === 'markdown') continue
      const loaded = await load().catch(() => null)
      if (!loaded) failed.push(name)
      else if (loaded.language) check(loaded.language, name)
    }
    check(markdownLanguage, 'markdown')
    expect(failed.toSorted()).toEqual(NEEDS_WINDOW)
    expect(missing).toEqual([])
  })

  it('give Markdown the scheme Markdown colours, or bold and italic where it has none', () => {
    const catppuccin = scheme('catppuccin-mocha')
    const heading = catppuccin.attributes.MARKDOWN_HEADER_LEVEL_2
    expect(rule(catppuccin, 'markup.heading.2')?.foreground).toBe(heading?.foreground?.slice(1))
    expect(rule(catppuccin, 'markup.list')?.foreground).toBe(
      catppuccin.attributes.MARKDOWN_LIST_MARKER?.foreground?.slice(1)
    )
    expect(rule(islandsDark, 'markup.code.span')?.background).toBe(
      islandsDark.attributes.MARKDOWN_CODE_SPAN?.background?.slice(1)
    )
    // Darcula sets no Markdown colours.
    const darcula = scheme('darcula')
    expect(rule(darcula, 'markup.heading.1')).toMatchObject({
      fontStyle: 'bold',
      foreground: rule(darcula, 'keyword')?.foreground
    })
    expect(rule(darcula, 'markup.bold')?.fontStyle).toBe('bold')
    expect(rule(darcula, 'markup.italic')?.fontStyle).toBe('italic')
  })
})
