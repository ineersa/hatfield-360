import type { editor } from 'monaco-editor'
import { tokenAttributes } from '../../lib/editor-scheme'
import type { EditorScheme, TextAttributes } from '../../../../shared/themes/editor-scheme'

/**
 * Monaco's token classes and the scheme keys that colour them, most specific first. Monaco matches
 * rules by prefix (`keyword` covers `keyword.flow.ts`), and a class without a key gets plain text.
 */
const TOKEN_KEYS: readonly (readonly [string, readonly string[]])[] = [
  ['comment', ['DEFAULT_LINE_COMMENT']],
  ['comment.doc', ['DEFAULT_DOC_COMMENT', 'DEFAULT_BLOCK_COMMENT', 'DEFAULT_LINE_COMMENT']],
  ['keyword', ['DEFAULT_KEYWORD']],
  ['string', ['DEFAULT_STRING']],
  ['string.escape', ['DEFAULT_VALID_STRING_ESCAPE', 'DEFAULT_STRING']],
  ['string.invalid', ['DEFAULT_INVALID_STRING_ESCAPE', 'DEFAULT_STRING']],
  // JetBrains draws JSON keys as fields unless the scheme gives them a colour of their own.
  ['string.key.json', ['JSON.PROPERTY_KEY', 'DEFAULT_INSTANCE_FIELD', 'DEFAULT_IDENTIFIER']],
  ['string.link', ['MARKDOWN_LINK_TEXT', 'HYPERLINK_ATTRIBUTES']],
  ['regexp', ['JS.REGEXP', 'DEFAULT_STRING']],
  ['number', ['DEFAULT_NUMBER']],
  ['constant', ['DEFAULT_CONSTANT', 'DEFAULT_IDENTIFIER']],
  ['type', ['DEFAULT_CLASS_NAME', 'DEFAULT_CLASS_REFERENCE', 'DEFAULT_IDENTIFIER']],
  ['identifier', ['DEFAULT_IDENTIFIER']],
  ['variable', ['DEFAULT_LOCAL_VARIABLE', 'DEFAULT_IDENTIFIER']],
  ['variable.predefined', ['DEFAULT_PREDEFINED_SYMBOL', 'DEFAULT_IDENTIFIER']],
  ['predefined', ['DEFAULT_PREDEFINED_SYMBOL', 'DEFAULT_IDENTIFIER']],
  ['annotation', ['DEFAULT_METADATA']],
  ['metatag', ['XML_PROLOGUE', 'DEFAULT_METADATA']],
  ['operator', ['DEFAULT_OPERATION_SIGN']],
  ['delimiter', ['DEFAULT_OPERATION_SIGN']],
  ['delimiter.bracket', ['DEFAULT_BRACES']],
  ['delimiter.parenthesis', ['DEFAULT_PARENTHS']],
  ['delimiter.square', ['DEFAULT_BRACKETS']],
  ['tag', ['HTML_TAG_NAME', 'XML_TAG_NAME', 'DEFAULT_TAG']],
  ['attribute.name', ['HTML_ATTRIBUTE_NAME', 'XML_ATTRIBUTE_NAME', 'DEFAULT_ATTRIBUTE']],
  ['attribute.value', ['HTML_ATTRIBUTE_VALUE', 'DEFAULT_STRING']]
]

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
      ...TOKEN_KEYS.map(([token, keys]) => rule(token, tokenAttributes(scheme, keys), text))
    ],
    colors: Object.fromEntries(
      entries.filter((entry): entry is [string, string] => entry[1] !== undefined)
    )
  }
}
