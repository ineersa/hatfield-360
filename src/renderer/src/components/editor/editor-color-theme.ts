import { tokenAttributes } from '../../lib/editor-scheme'
import type { EditorScheme, TextAttributes } from '../../../../shared/themes/editor-scheme'

/**
 * TextMate scopes and the scheme keys that colour them, most specific key first. When the scheme
 * sets none of `keys`, the first of `fallback` it sets, in `style` (bold Markdown is bold in a
 * scheme without Markdown colours, as in the IDE, whose Markdown colours default to that).
 */
type ScopeKeys = {
  scopes: readonly string[]
  keys: readonly string[]
  fallback?: { keys: readonly string[]; style: Pick<TextAttributes, 'bold' | 'italic'> }
}

const colours = (scopes: string | string[], ...keys: string[]): ScopeKeys => ({
  scopes: typeof scopes === 'string' ? [scopes] : scopes,
  keys
})
const markdown = (
  scopes: string | string[],
  key: string,
  fallback: string[],
  style: Pick<TextAttributes, 'bold' | 'italic'> = {}
): ScopeKeys => ({ ...colours(scopes, key), fallback: { keys: fallback, style } })

/**
 * VS Code's TextMate scopes for the JetBrains keys. A scope matches itself and its children
 * (`string` covers `string.quoted.double.ts`), and the most specific matching selector wins.
 */
const SCOPE_KEYS: readonly ScopeKeys[] = [
  colours('comment', 'DEFAULT_LINE_COMMENT'),
  colours('comment.block', 'DEFAULT_BLOCK_COMMENT', 'DEFAULT_LINE_COMMENT'),
  colours(
    'comment.block.documentation',
    'DEFAULT_DOC_COMMENT',
    'DEFAULT_BLOCK_COMMENT',
    'DEFAULT_LINE_COMMENT'
  ),
  colours('storage.type.class.jsdoc', 'DEFAULT_DOC_COMMENT_TAG', 'DEFAULT_DOC_COMMENT'),
  // JetBrains draws `this`, `true` and `null` as keywords.
  colours(
    ['keyword', 'storage', 'constant.language', 'variable.language', 'support.type.primitive'],
    'DEFAULT_KEYWORD'
  ),
  colours(['keyword.operator', 'punctuation', 'meta.brace'], 'DEFAULT_OPERATION_SIGN'),
  // Word operators (`typeof`, `instanceof`, `new`) are keywords in JetBrains IDEs.
  colours(
    ['keyword.operator.expression', 'keyword.operator.new', 'keyword.operator.word'],
    'DEFAULT_KEYWORD'
  ),
  colours(
    ['punctuation.separator', 'punctuation.terminator'],
    'DEFAULT_COMMA',
    'DEFAULT_SEMICOLON',
    'DEFAULT_OPERATION_SIGN'
  ),
  colours('punctuation.accessor', 'DEFAULT_DOT', 'DEFAULT_OPERATION_SIGN'),
  colours(
    ['meta.brace.round', 'punctuation.definition.parameters'],
    'DEFAULT_PARENTHS',
    'DEFAULT_OPERATION_SIGN'
  ),
  colours(
    ['meta.brace.square', 'punctuation.definition.array'],
    'DEFAULT_BRACKETS',
    'DEFAULT_OPERATION_SIGN'
  ),
  colours(
    ['meta.brace.curly', 'punctuation.definition.block'],
    'DEFAULT_BRACES',
    'DEFAULT_OPERATION_SIGN'
  ),
  // Quotes and comment markers belong to their string or comment, as in the IDE.
  colours(['string', 'punctuation.definition.string'], 'DEFAULT_STRING'),
  colours('punctuation.definition.comment', 'DEFAULT_LINE_COMMENT'),
  colours('constant.character.escape', 'DEFAULT_VALID_STRING_ESCAPE', 'DEFAULT_STRING'),
  colours(
    'invalid.illegal.unrecognized-string-escape',
    'DEFAULT_INVALID_STRING_ESCAPE',
    'DEFAULT_STRING'
  ),
  colours('string.regexp', 'JS.REGEXP', 'DEFAULT_STRING'),
  colours(
    ['punctuation.definition.template-expression', 'punctuation.section.embedded'],
    'DEFAULT_VALID_STRING_ESCAPE',
    'DEFAULT_OPERATION_SIGN'
  ),
  colours('constant.numeric', 'DEFAULT_NUMBER'),
  colours(
    ['constant.other', 'variable.other.constant', 'variable.other.enummember'],
    'DEFAULT_CONSTANT',
    'DEFAULT_IDENTIFIER'
  ),
  colours(
    [
      'entity.name.type',
      'entity.name.class',
      'entity.other.inherited-class',
      'support.class',
      'support.type',
      'entity.name.namespace'
    ],
    'DEFAULT_CLASS_NAME',
    'DEFAULT_CLASS_REFERENCE',
    'DEFAULT_IDENTIFIER'
  ),
  colours(
    'entity.name.type.interface',
    'DEFAULT_INTERFACE_NAME',
    'DEFAULT_CLASS_NAME',
    'DEFAULT_IDENTIFIER'
  ),
  colours('variable', 'DEFAULT_LOCAL_VARIABLE', 'DEFAULT_IDENTIFIER'),
  colours('variable.other.readwrite', 'DEFAULT_LOCAL_VARIABLE', 'DEFAULT_IDENTIFIER'),
  colours('variable.parameter', 'DEFAULT_PARAMETER', 'DEFAULT_IDENTIFIER'),
  colours(
    [
      'variable.other.property',
      'variable.other.object.property',
      'support.variable.property',
      'meta.object-literal.key',
      'variable.other.member'
    ],
    'DEFAULT_INSTANCE_FIELD',
    'DEFAULT_IDENTIFIER'
  ),
  colours(
    ['support.variable', 'support.constant'],
    'DEFAULT_PREDEFINED_SYMBOL',
    'DEFAULT_IDENTIFIER'
  ),
  colours(
    ['entity.name.function', 'meta.definition.method entity.name.function'],
    'DEFAULT_FUNCTION_DECLARATION',
    'DEFAULT_IDENTIFIER'
  ),
  colours(
    ['meta.function-call entity.name.function', 'support.function', 'entity.name.function.member'],
    'DEFAULT_FUNCTION_CALL',
    'DEFAULT_IDENTIFIER'
  ),
  colours(
    [
      'meta.decorator',
      'entity.name.function.decorator',
      'punctuation.decorator',
      'storage.type.annotation',
      'meta.preprocessor',
      'keyword.control.directive'
    ],
    'DEFAULT_METADATA'
  ),
  // JSON keys are fields unless the scheme gives them a colour of their own.
  colours(
    'support.type.property-name.json',
    'JSON.PROPERTY_KEY',
    'DEFAULT_INSTANCE_FIELD',
    'DEFAULT_IDENTIFIER'
  ),
  colours(
    'support.type.property-name.css',
    'CSS.PROPERTY_NAME',
    'DEFAULT_INSTANCE_FIELD',
    'DEFAULT_IDENTIFIER'
  ),
  colours(
    ['support.type.property-name', 'entity.name.tag.yaml', 'keyword.other.definition.ini'],
    'PROPERTIES.KEY',
    'DEFAULT_INSTANCE_FIELD',
    'DEFAULT_IDENTIFIER'
  ),
  colours('entity.name.tag', 'HTML_TAG_NAME', 'XML_TAG_NAME', 'DEFAULT_TAG'),
  colours('punctuation.definition.tag', 'HTML_TAG', 'XML_TAG', 'DEFAULT_TAG'),
  colours(
    'entity.other.attribute-name',
    'HTML_ATTRIBUTE_NAME',
    'XML_ATTRIBUTE_NAME',
    'DEFAULT_ATTRIBUTE'
  ),
  colours('meta.attribute string', 'HTML_ATTRIBUTE_VALUE', 'DEFAULT_STRING'),
  colours('constant.character.entity', 'HTML_ENTITY_REFERENCE', 'DEFAULT_VALID_STRING_ESCAPE'),
  colours('meta.tag.preprocessor.xml', 'XML_PROLOGUE', 'DEFAULT_METADATA'),
  colours('invalid', 'BAD_CHARACTER'),
  colours(['markup.inserted', 'meta.diff.header.to-file'], 'DIFF_INSERTED', 'DEFAULT_STRING'),
  colours(['markup.deleted', 'meta.diff.header.from-file'], 'DIFF_DELETED', 'DEFAULT_LINE_COMMENT'),
  colours('markup.changed', 'DIFF_MODIFIED', 'DEFAULT_KEYWORD'),
  // Markdown, from VS Code's Markdown grammar.
  ...[1, 2, 3, 4, 5, 6].map((level) =>
    markdown(
      [`heading.${level}.markdown`, `heading.${level}.markdown punctuation.definition.heading`],
      `MARKDOWN_HEADER_LEVEL_${level}`,
      ['DEFAULT_KEYWORD'],
      { bold: true }
    )
  ),
  markdown(['markup.bold', 'punctuation.definition.bold'], 'MARKDOWN_BOLD', [], { bold: true }),
  markdown(['markup.italic', 'punctuation.definition.italic'], 'MARKDOWN_ITALIC', [], {
    italic: true
  }),
  markdown(
    ['markup.inline.raw', 'markup.inline.raw punctuation.definition.raw'],
    'MARKDOWN_CODE_SPAN',
    ['DEFAULT_STRING']
  ),
  markdown(['markup.raw.block', 'markup.fenced_code.block'], 'MARKDOWN_CODE_BLOCK', [
    'MARKDOWN_CODE_FENCE',
    'DEFAULT_STRING'
  ]),
  markdown(
    ['punctuation.definition.markdown', 'fenced_code.block.language'],
    'MARKDOWN_CODE_FENCE',
    ['MARKDOWN_CODE_BLOCK', 'DEFAULT_STRING']
  ),
  markdown(
    ['markup.quote', 'punctuation.definition.quote.begin.markdown'],
    'MARKDOWN_BLOCK_QUOTE_MARKER',
    ['DEFAULT_LINE_COMMENT']
  ),
  markdown('punctuation.definition.list.begin.markdown', 'MARKDOWN_LIST_MARKER', [
    'DEFAULT_KEYWORD'
  ]),
  markdown('meta.separator.markdown', 'MARKDOWN_HRULE', ['DEFAULT_KEYWORD']),
  markdown(['string.other.link.title', 'string.other.link.description'], 'MARKDOWN_LINK_TEXT', [
    'HYPERLINK_ATTRIBUTES'
  ]),
  markdown('markup.underline.link', 'MARKDOWN_LINK_DESTINATION', ['DEFAULT_STRING'])
]

function scopeKeyAttributes(scheme: EditorScheme, entry: ScopeKeys): TextAttributes {
  const own = tokenAttributes(scheme, entry.keys)
  if (!entry.fallback || entry.keys.some((key) => scheme.attributes[key])) return own
  return { ...tokenAttributes(scheme, entry.fallback.keys), ...entry.fallback.style }
}

type TokenColor = {
  scope?: string[]
  settings: { foreground?: string; background?: string; fontStyle: string }
}

function tokenColor(
  own: TextAttributes,
  text: TextAttributes,
  scope?: readonly string[]
): TokenColor {
  const foreground = own.foreground ?? text.foreground
  return {
    ...(scope ? { scope: [...scope] } : {}),
    // Every scope gets a colour and a style, so a parent's style never leaks into a child.
    settings: {
      fontStyle: [own.bold && 'bold', own.italic && 'italic'].filter(Boolean).join(' '),
      ...(foreground ? { foreground } : {}),
      ...(own.background ? { background: own.background } : {})
    }
  }
}

/** The app theme's popup colours, which the editor's context menu takes, as in the rest of the app. */
export type MenuColors = {
  background: string
  foreground: string
  border: string
  selection: string
  selectionForeground: string
  separator: string
}

/** A VS Code colour theme file's contents. */
export type ColorTheme = {
  type: 'dark' | 'light'
  colors: Record<string, string>
  tokenColors: TokenColor[]
}

/**
 * The VS Code colour theme for a JetBrains editor scheme: token colours and the editor's own
 * colours, with the context menu in the app theme's popup colours (JetBrains schemes colour only
 * the editor). Nothing comes from another theme, so none of VS Code's colours show through.
 */
export function editorColorTheme(scheme: EditorScheme, menu: MenuColors): ColorTheme {
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
    type: scheme.dark ? 'dark' : 'light',
    colors: Object.fromEntries(
      entries.filter((entry): entry is [string, string] => entry[1] !== undefined)
    ),
    tokenColors: [
      tokenColor(text, text),
      ...SCOPE_KEYS.map((entry) =>
        tokenColor(scopeKeyAttributes(scheme, entry), text, entry.scopes)
      )
    ]
  }
}
