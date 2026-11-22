import type { editor } from 'monaco-editor'
import { tokenAttributes } from '../../lib/editor-scheme'
import type { EditorScheme, TextAttributes } from '../../../../shared/themes/editor-scheme'

/**
 * A token class's colour and style: the first of `keys` the scheme sets. When it sets none of them,
 * the first of `fallback` it sets, in `style` (bold Markdown is bold in a scheme without Markdown
 * colours, as in the IDE, whose Markdown colours default to that).
 */
type TokenKeys = {
  token: string
  keys: readonly string[]
  fallback?: { keys: readonly string[]; style: Pick<TextAttributes, 'bold' | 'italic'> }
}

const colours = (token: string, ...keys: string[]): TokenKeys => ({ token, keys })
const markdown = (
  token: string,
  key: string,
  fallback: string[],
  style: Pick<TextAttributes, 'bold' | 'italic'> = {}
): TokenKeys => ({ token, keys: [key], fallback: { keys: fallback, style } })

/**
 * Monaco's token classes and the scheme keys that colour them, most specific first. Monaco matches
 * rules by prefix (`keyword` covers `keyword.flow.ts`); a unit test checks every class its
 * languages use has one, so none is drawn as plain text by omission.
 */
const TOKEN_KEYS: readonly TokenKeys[] = [
  colours('comment', 'DEFAULT_LINE_COMMENT'),
  colours('comment.doc', 'DEFAULT_DOC_COMMENT', 'DEFAULT_BLOCK_COMMENT', 'DEFAULT_LINE_COMMENT'),
  colours('keyword', 'DEFAULT_KEYWORD'),
  colours('string', 'DEFAULT_STRING'),
  colours('string.escape', 'DEFAULT_VALID_STRING_ESCAPE', 'DEFAULT_STRING'),
  colours('string.invalid', 'DEFAULT_INVALID_STRING_ESCAPE', 'DEFAULT_STRING'),
  // JetBrains draws JSON keys as fields unless the scheme gives them a colour of their own.
  colours('string.key.json', 'JSON.PROPERTY_KEY', 'DEFAULT_INSTANCE_FIELD', 'DEFAULT_IDENTIFIER'),
  colours('string.link', 'MARKDOWN_LINK_TEXT', 'HYPERLINK_ATTRIBUTES'),
  colours('regexp', 'JS.REGEXP', 'DEFAULT_STRING'),
  colours('number', 'DEFAULT_NUMBER'),
  colours('constant', 'DEFAULT_CONSTANT', 'DEFAULT_IDENTIFIER'),
  colours('constants', 'DEFAULT_CONSTANT', 'DEFAULT_IDENTIFIER'),
  colours('global.constant', 'DEFAULT_CONSTANT', 'DEFAULT_IDENTIFIER'),
  colours('type', 'DEFAULT_CLASS_NAME', 'DEFAULT_CLASS_REFERENCE', 'DEFAULT_IDENTIFIER'),
  colours('namespace', 'DEFAULT_CLASS_NAME', 'DEFAULT_CLASS_REFERENCE', 'DEFAULT_IDENTIFIER'),
  colours('identifier', 'DEFAULT_IDENTIFIER'),
  colours('variable', 'DEFAULT_LOCAL_VARIABLE', 'DEFAULT_IDENTIFIER'),
  colours('variable.predefined', 'DEFAULT_PREDEFINED_SYMBOL', 'DEFAULT_IDENTIFIER'),
  colours('predefined', 'DEFAULT_PREDEFINED_SYMBOL', 'DEFAULT_IDENTIFIER'),
  colours('argument', 'DEFAULT_PARAMETER', 'DEFAULT_IDENTIFIER'),
  // INI, Lua, Less and Scala keys: the IDE's property keys.
  colours('key', 'PROPERTIES.KEY', 'DEFAULT_INSTANCE_FIELD', 'DEFAULT_IDENTIFIER'),
  colours('function', 'DEFAULT_FUNCTION_DECLARATION', 'DEFAULT_IDENTIFIER'),
  colours('function.call', 'DEFAULT_FUNCTION_CALL', 'DEFAULT_IDENTIFIER'),
  colours('constructor', 'DEFAULT_FUNCTION_CALL', 'DEFAULT_IDENTIFIER'),
  colours('annotation', 'DEFAULT_METADATA'),
  colours('meta', 'DEFAULT_METADATA'),
  colours('directive', 'DEFAULT_METADATA'),
  colours('metatag', 'XML_PROLOGUE', 'DEFAULT_METADATA'),
  colours('sigil', 'DEFAULT_STRING'),
  colours('literal', 'DEFAULT_STRING'),
  colours('interpolation', 'DEFAULT_VALID_STRING_ESCAPE', 'DEFAULT_OPERATION_SIGN'),
  colours('escape', 'DEFAULT_VALID_STRING_ESCAPE', 'DEFAULT_STRING'),
  colours('invalid', 'BAD_CHARACTER'),
  colours('error-token', 'BAD_CHARACTER'),
  colours('operator', 'DEFAULT_OPERATION_SIGN'),
  colours('operators', 'DEFAULT_OPERATION_SIGN'),
  colours('punctuation', 'DEFAULT_OPERATION_SIGN'),
  colours('wildcard', 'DEFAULT_OPERATION_SIGN'),
  colours('delimiter', 'DEFAULT_OPERATION_SIGN'),
  // Swift's spelling.
  colours('delimeter', 'DEFAULT_OPERATION_SIGN'),
  colours('delimiter.bracket', 'DEFAULT_BRACES'),
  colours('delimiter.parenthesis', 'DEFAULT_PARENTHS'),
  colours('delimiter.square', 'DEFAULT_BRACKETS'),
  colours('tag', 'HTML_TAG_NAME', 'XML_TAG_NAME', 'DEFAULT_TAG'),
  colours('attribute.name', 'HTML_ATTRIBUTE_NAME', 'XML_ATTRIBUTE_NAME', 'DEFAULT_ATTRIBUTE'),
  colours('attribute.value', 'HTML_ATTRIBUTE_VALUE', 'DEFAULT_STRING'),
  colours('attribute.delimiter', 'DEFAULT_OPERATION_SIGN'),
  // Markdown (`markdown-tokens.ts`), and the bold and italic of reStructuredText and MDX.
  ...[1, 2, 3, 4, 5, 6].map((level) =>
    markdown(`markup.heading.${level}`, `MARKDOWN_HEADER_LEVEL_${level}`, ['DEFAULT_KEYWORD'], {
      bold: true
    })
  ),
  markdown('markup.bold', 'MARKDOWN_BOLD', [], { bold: true }),
  markdown('strong', 'MARKDOWN_BOLD', [], { bold: true }),
  markdown('markup.italic', 'MARKDOWN_ITALIC', [], { italic: true }),
  markdown('emphasis', 'MARKDOWN_ITALIC', [], { italic: true }),
  markdown('markup.code.span', 'MARKDOWN_CODE_SPAN', ['DEFAULT_STRING']),
  markdown('markup.code.block', 'MARKDOWN_CODE_BLOCK', ['MARKDOWN_CODE_FENCE', 'DEFAULT_STRING']),
  markdown('markup.code.fence', 'MARKDOWN_CODE_FENCE', ['MARKDOWN_CODE_BLOCK', 'DEFAULT_STRING']),
  markdown('markup.quote', 'MARKDOWN_BLOCK_QUOTE_MARKER', ['DEFAULT_LINE_COMMENT']),
  markdown('markup.list', 'MARKDOWN_LIST_MARKER', ['DEFAULT_KEYWORD']),
  markdown('markup.hrule', 'MARKDOWN_HRULE', ['DEFAULT_KEYWORD']),
  markdown('markup.table', 'MARKDOWN_TABLE_SEPARATOR', ['DEFAULT_OPERATION_SIGN']),
  markdown('markup.table.header', 'MARKDOWN_TABLE_HEADER', [], { bold: true }),
  markdown('markup.link.text', 'MARKDOWN_LINK_TEXT', ['HYPERLINK_ATTRIBUTES']),
  markdown('markup.link.destination', 'MARKDOWN_LINK_DESTINATION', ['DEFAULT_STRING']),
  markdown('markup.link.auto', 'MARKDOWN_AUTO_LINK', ['MARKDOWN_LINK_TEXT', 'HYPERLINK_ATTRIBUTES'])
]

function tokenKeyAttributes(scheme: EditorScheme, entry: TokenKeys): TextAttributes {
  const own = tokenAttributes(scheme, entry.keys)
  if (!entry.fallback || entry.keys.some((key) => scheme.attributes[key])) return own
  return { ...tokenAttributes(scheme, entry.fallback.keys), ...entry.fallback.style }
}

/** Monaco wants token colours as `rrggbb`; the scheme's are `#rrggbb` or `#rrggbbaa`. */
const tokenColor = (color: string | undefined): string | undefined => color?.slice(1, 7)

function rule(token: string, own: TextAttributes, text: TextAttributes): editor.ITokenThemeRule {
  const foreground = tokenColor(own.foreground ?? text.foreground)
  const background = tokenColor(own.background)
  const fontStyle = [own.bold && 'bold', own.italic && 'italic'].filter(Boolean).join(' ')
  return {
    token,
    // Every class gets a colour and a style, so none of Monaco's own theme shows through.
    fontStyle,
    ...(foreground ? { foreground } : {}),
    ...(background ? { background } : {})
  }
}

/** The app theme's popup colours, which Monaco's context menu takes, as in the rest of the app. */
export type MenuColors = {
  background: string
  foreground: string
  border: string
  selection: string
  selectionForeground: string
  separator: string
}

/**
 * The Monaco theme for a JetBrains editor scheme: token colours and the editor's own colours, with
 * the context menu in the app theme's popup colours (JetBrains schemes colour only the editor).
 */
export function monacoTheme(scheme: EditorScheme, menu: MenuColors): editor.IStandaloneThemeData {
  const { colors, attributes } = scheme
  const text = attributes.TEXT ?? {}
  const search = attributes.TEXT_SEARCH_RESULT_ATTRIBUTES?.background
  const entries: [string, string | undefined][] = [
    ['editor.background', text.background],
    ['editor.foreground', text.foreground],
    ['editorCursor.foreground', colors.CARET_COLOR],
    ['editor.lineHighlightBackground', colors.CARET_ROW_COLOR],
    // The caret row is a fill in JetBrains IDEs, never an outline.
    ['editor.lineHighlightBorder', colors.CARET_ROW_COLOR],
    ['editorLineNumber.foreground', colors.LINE_NUMBERS_COLOR],
    ['editorLineNumber.activeForeground', colors.LINE_NUMBER_ON_CARET_ROW_COLOR],
    // The New UI's gutter; GUTTER_BACKGROUND is the classic UI's.
    ['editorGutter.background', colors.EDITOR_GUTTER_BACKGROUND ?? text.background],
    ['editor.selectionBackground', colors.SELECTION_BACKGROUND],
    ['editor.selectionForeground', colors.SELECTION_FOREGROUND],
    [
      'editor.inactiveSelectionBackground',
      colors.SELECTION_BACKGROUND_INACTIVE ?? colors.SELECTION_BACKGROUND
    ],
    ['editorIndentGuide.background1', colors.INDENT_GUIDE],
    ['editorIndentGuide.activeBackground1', colors.SELECTED_INDENT_GUIDE],
    ['editorWhitespace.foreground', colors.WHITESPACES],
    ['editorRuler.foreground', colors.RIGHT_MARGIN_COLOR],
    ['editor.findMatchBackground', search],
    ['editor.findMatchHighlightBackground', search],
    ['editorBracketMatch.background', attributes.MATCHED_BRACE_ATTRIBUTES?.background],
    ['editorBracketMatch.border', attributes.MATCHED_BRACE_ATTRIBUTES?.effect?.color],
    ['editor.wordHighlightBackground', attributes.IDENTIFIER_UNDER_CARET_ATTRIBUTES?.background],
    [
      'editor.wordHighlightStrongBackground',
      attributes.WRITE_IDENTIFIER_UNDER_CARET_ATTRIBUTES?.background
    ],
    ['editorError.foreground', attributes.ERRORS_ATTRIBUTES?.effect?.color],
    ['editorWarning.foreground', attributes.WARNING_ATTRIBUTES?.effect?.color],
    // JetBrains' error stripe has no border.
    ['editorOverviewRuler.border', text.background],
    ['menu.background', menu.background],
    ['menu.foreground', menu.foreground],
    ['menu.border', menu.border],
    ['menu.selectionBackground', menu.selection],
    ['menu.selectionForeground', menu.selectionForeground],
    ['menu.separatorBackground', menu.separator]
  ]
  return {
    base: scheme.dark ? 'vs-dark' : 'vs',
    // Inherited token rules are more specific than ours (`string.value.json`, `keyword.flow`) and
    // would win over the scheme; colours missing here still come from the base's defaults.
    inherit: false,
    rules: [
      rule('', text, text),
      ...TOKEN_KEYS.map((entry) => rule(entry.token, tokenKeyAttributes(scheme, entry), text))
    ],
    colors: Object.fromEntries(
      entries.filter((entry): entry is [string, string] => entry[1] !== undefined)
    )
  }
}
