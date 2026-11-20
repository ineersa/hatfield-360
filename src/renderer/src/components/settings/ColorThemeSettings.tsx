import { useId } from 'react'
import { cssFontFamily } from '@/lib/css-font-family'
import { tokenAttributes, useEditorScheme } from '@/lib/editor-scheme'
import { terminalPalette } from '@/lib/terminal-theme'
import { useSettingsStore } from '@/state/settings-store'
import type { Settings } from '../../../../shared/settings-api'
import { APP_THEMES } from '../../../../shared/themes/app-theme-catalog'
import type { EditorScheme, TextAttributes } from '../../../../shared/themes/editor-scheme'
import { EDITOR_THEMES } from '../../../../shared/themes/editor-theme-catalog'
import { TERMINAL_THEMES } from '../../../../shared/themes/terminal-theme-catalog'
import { ResetButton } from './ResetButton'

type ThemeKey = 'workbench.colorTheme' | 'editor.colorTheme' | 'terminal.colorTheme'

function ThemeSetting<K extends ThemeKey>({
  settingKey,
  name,
  description,
  themes,
  children
}: {
  settingKey: K
  name: string
  description: string
  themes: readonly { id: Settings[K]; label: string }[]
  children?: React.ReactNode
}): React.JSX.Element {
  const current = useSettingsStore((state) => state.values[settingKey])
  const editable = useSettingsStore((state) => state.editable)
  const update = useSettingsStore((state) => state.update)
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2 py-4">
      <div>
        <h3 id={headingId} className="type-section-title">
          {name}
        </h3>
        <p className="type-description">{description}</p>
      </div>
      <div className="flex items-center gap-2">
        <select
          aria-label={name}
          value={current}
          disabled={!editable}
          onChange={(event) => {
            const theme = themes.find(({ id }) => id === event.target.value)
            if (theme) void update(settingKey, theme.id)
          }}
          className="h-control min-w-0 flex-1 rounded-component border border-input-border bg-input px-2 text-input-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          {themes.map(({ id, label }) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <ResetButton settingKey={settingKey} label={name} />
      </div>
      {children}
    </section>
  )
}

/** Token kinds of the preview and the scheme keys that colour them, most specific first. */
const TOKEN_KEYS = {
  text: [],
  comment: ['DEFAULT_LINE_COMMENT'],
  keyword: ['DEFAULT_KEYWORD'],
  string: ['DEFAULT_STRING'],
  escape: ['DEFAULT_VALID_STRING_ESCAPE', 'DEFAULT_STRING'],
  number: ['DEFAULT_NUMBER'],
  className: ['DEFAULT_CLASS_NAME', 'DEFAULT_IDENTIFIER'],
  field: ['DEFAULT_INSTANCE_FIELD', 'DEFAULT_IDENTIFIER'],
  function: ['DEFAULT_FUNCTION_DECLARATION', 'DEFAULT_IDENTIFIER'],
  call: ['DEFAULT_FUNCTION_CALL', 'DEFAULT_IDENTIFIER'],
  parameter: ['DEFAULT_PARAMETER', 'DEFAULT_IDENTIFIER'],
  local: ['DEFAULT_LOCAL_VARIABLE', 'DEFAULT_IDENTIFIER'],
  unused: ['NOT_USED_ELEMENT_ATTRIBUTES'],
  operator: ['DEFAULT_OPERATION_SIGN'],
  punctuation: ['DEFAULT_COMMA', 'DEFAULT_OPERATION_SIGN']
} as const

type TokenKind = keyof typeof TOKEN_KEYS
/** Text, its token kind (plain text when omitted), and a selection or search match over it. */
type Token = string | [TokenKind, string] | [TokenKind, string, 'selection' | 'search']
type Line = { tokens: Token[]; caret?: true; change?: 'added' | 'modified' }

const SAMPLE: Line[] = [
  { tokens: [['comment', '// Greets each visitor and counts them']] },
  {
    tokens: [
      ['keyword', 'import'],
      ' { ',
      ['call', 'readFile'],
      ' } ',
      ['keyword', 'from'],
      ' ',
      ['string', "'node:fs/promises'"]
    ]
  },
  { tokens: [] },
  { tokens: [['keyword', 'export class'], ' ', ['className', 'Greeter'], ' {'] },
  {
    tokens: [
      '  ',
      ['keyword', 'private'],
      ' ',
      ['field', 'count'],
      ' ',
      ['operator', '='],
      ' ',
      ['number', '0']
    ]
  },
  { tokens: [] },
  {
    tokens: [
      '  ',
      ['keyword', 'async'],
      ' ',
      ['function', 'greet'],
      '(',
      ['parameter', 'name'],
      ': ',
      ['keyword', 'string'],
      ['punctuation', ','],
      ' ',
      ['unused', 'retries'],
      ': ',
      ['keyword', 'number'],
      ') {'
    ]
  },
  {
    tokens: [
      '    ',
      ['keyword', 'this'],
      '.',
      ['field', 'count'],
      ' ',
      ['operator', '+='],
      ' ',
      ['number', '1']
    ],
    caret: true
  },
  {
    tokens: [
      '    ',
      ['keyword', 'const'],
      ' ',
      ['local', 'greeting'],
      ' ',
      ['operator', '='],
      ' ',
      ['keyword', 'await'],
      ' ',
      ['call', 'readFile', 'selection'],
      '(',
      ['string', "'greeting.txt'"],
      ')'
    ],
    change: 'added'
  },
  {
    tokens: [
      '    ',
      ['keyword', 'return'],
      ' ',
      ['local', 'greeting', 'search'],
      ' ',
      ['operator', '+'],
      ' ',
      ['parameter', 'name'],
      ' ',
      ['operator', '+'],
      ' ',
      ['string', "'!"],
      ['escape', '\\n'],
      ['string', "'"]
    ],
    change: 'modified'
  },
  { tokens: ['  }'] },
  { tokens: ['}'] }
]

const EFFECT_LINES: Record<NonNullable<TextAttributes['effect']>['type'], string> = {
  box: 'none',
  underline: 'underline',
  'bold-underline': 'underline',
  'dotted-underline': 'underline dotted',
  wave: 'underline wavy',
  strikethrough: 'line-through'
}

function tokenStyle(
  scheme: EditorScheme,
  kind: TokenKind,
  mark: 'selection' | 'search' | undefined
): React.CSSProperties {
  const text = scheme.attributes.TEXT ?? {}
  const own = tokenAttributes(scheme, TOKEN_KEYS[kind])
  const search = scheme.attributes.TEXT_SEARCH_RESULT_ATTRIBUTES
  const background =
    mark === 'selection'
      ? scheme.colors.SELECTION_BACKGROUND
      : mark === 'search'
        ? search?.background
        : own.background
  const color =
    mark === 'selection' && scheme.colors.SELECTION_FOREGROUND
      ? scheme.colors.SELECTION_FOREGROUND
      : (own.foreground ?? text.foreground)
  const effect = own.effect
  return {
    color,
    backgroundColor: background,
    fontWeight: own.bold ? 'bold' : undefined,
    fontStyle: own.italic ? 'italic' : undefined,
    ...(effect && effect.type !== 'box'
      ? { textDecoration: `${EFFECT_LINES[effect.type]} ${effect.color}` }
      : {}),
    ...(effect?.type === 'box' ? { outline: `1px solid ${effect.color}` } : {})
  }
}

/** Sample code in the chosen editor scheme: syntax, caret row, selection, search match, line numbers, diff marks. */
function EditorThemePreview(): React.JSX.Element | null {
  const id = useSettingsStore((state) => state.values['editor.colorTheme'])
  const fontFamily = useSettingsStore((state) => state.values['editor.fontFamily'])
  const fontSize = useSettingsStore((state) => state.values['editor.fontSize'])
  const scheme = useEditorScheme(id)
  // Loads in a frame or two; the section grows once it has.
  if (!scheme) return null
  const { colors } = scheme
  const text = scheme.attributes.TEXT ?? {}
  const gutter = colors.GUTTER_BACKGROUND ?? text.background
  return (
    <div
      role="img"
      aria-label="Editor theme preview"
      data-scheme={id}
      className="overflow-x-auto rounded-component border border-separator"
      style={{
        backgroundColor: text.background,
        color: text.foreground,
        fontFamily: cssFontFamily(fontFamily),
        fontSize
      }}
    >
      <div className="py-2">
        {SAMPLE.map((line, index) => (
          <div
            key={index}
            className="flex whitespace-pre"
            style={{ backgroundColor: line.caret ? colors.CARET_ROW_COLOR : undefined }}
          >
            <span
              className="w-10 shrink-0 pr-3 text-right select-none"
              style={{
                backgroundColor: line.caret ? undefined : gutter,
                color: line.caret
                  ? (colors.LINE_NUMBER_ON_CARET_ROW_COLOR ?? colors.LINE_NUMBERS_COLOR)
                  : colors.LINE_NUMBERS_COLOR
              }}
            >
              {index + 1}
            </span>
            <span
              aria-hidden
              className="w-1 shrink-0"
              style={{
                backgroundColor:
                  line.change === 'added'
                    ? colors.ADDED_LINES_COLOR
                    : line.change === 'modified'
                      ? colors.MODIFIED_LINES_COLOR
                      : gutter
              }}
            />
            <span className="pl-3">
              {line.tokens.map((token, at) => {
                const [kind, value, mark] =
                  typeof token === 'string' ? (['text', token] as const) : token
                return (
                  <span key={at} data-token={kind} style={tokenStyle(scheme, kind, mark)}>
                    {value}
                  </span>
                )
              })}
              {line.caret ? (
                <span
                  aria-hidden
                  className="inline-block w-0.5 align-text-bottom"
                  style={{ backgroundColor: colors.CARET_COLOR, height: '1.2em' }}
                />
              ) : null}
              {line.tokens.length === 0 ? ' ' : null}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** The terminal theme's background with its 16 ANSI colours. */
function TerminalThemePreview(): React.JSX.Element {
  const id = useSettingsStore((state) => state.values['terminal.colorTheme'])
  const { background, foreground, cursor, selection, ...ansi } = terminalPalette(id)
  return (
    <div
      role="img"
      aria-label="Terminal theme preview"
      className="flex flex-wrap items-center gap-1.5 rounded-component border border-separator px-3 py-2"
      style={{ backgroundColor: background, color: foreground }}
    >
      <span className="pr-2">
        $ ls <span style={{ backgroundColor: selection }}>src</span>
        <span
          aria-hidden
          className="ml-0.5 inline-block w-2 align-text-bottom"
          style={{ backgroundColor: cursor, height: '1.1em' }}
        />
      </span>
      {Object.entries(ansi).map(([name, colour]) => (
        <span
          key={name}
          title={name}
          className="size-4 rounded-full"
          style={{ backgroundColor: colour }}
        />
      ))}
    </div>
  )
}

export function ColorThemeSettings(): React.JSX.Element {
  return (
    <>
      <ThemeSetting
        settingKey="workbench.colorTheme"
        name="App theme"
        description="Colours, text and shapes of the window: panels, lists, menus, tooltips and the status bar."
        themes={APP_THEMES}
      />
      <ThemeSetting
        settingKey="editor.colorTheme"
        name="Editor theme"
        description="Syntax, editor and diff colours of files opened in the editor."
        themes={EDITOR_THEMES}
      >
        <EditorThemePreview />
      </ThemeSetting>
      <ThemeSetting
        settingKey="terminal.colorTheme"
        name="Terminal theme"
        description="Background, text and ANSI colours of terminals and agent sessions."
        themes={TERMINAL_THEMES}
      >
        <TerminalThemePreview />
      </ThemeSetting>
    </>
  )
}
