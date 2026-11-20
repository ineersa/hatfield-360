/** How a JetBrains scheme decorates text: `EFFECT_TYPE` in the scheme file. */
export type TextEffect = {
  type: 'box' | 'underline' | 'wave' | 'strikethrough' | 'bold-underline' | 'dotted-underline'
  color: string
}

/** One token kind's style in an editor scheme (`DEFAULT_KEYWORD`, `TEXT`, `PHP_VAR`, ...). */
export type TextAttributes = {
  foreground?: string
  background?: string
  bold?: true
  italic?: true
  effect?: TextEffect
  /** Marker colour in the scrollbar for errors, warnings and search results. */
  errorStripe?: string
}

/**
 * A JetBrains editor colour scheme with its parent schemes applied, as `pnpm themes:import` writes it:
 * editor colours (`CARET_ROW_COLOR`, `LINE_NUMBERS_COLOR`, `ADDED_LINES_COLOR`, ...) and text
 * attributes per token kind, keyed by the scheme's own names. Colours are `#rrggbb` or `#rrggbbaa`.
 */
export type EditorScheme = {
  name: string
  dark: boolean
  colors: Record<string, string>
  attributes: Record<string, TextAttributes>
}
