import type { EditorScheme } from '../../src/shared/themes/editor-scheme.ts'
import type { TerminalPalette } from '../../src/shared/themes/terminal-palette.ts'

/**
 * The terminal theme of an editor scheme: the console colours the IDE's terminal uses (`CONSOLE_GRAY`
 * is ANSI white, `CONSOLE_DARKGRAY` bright black, `CONSOLE_WHITE` bright white). Throws when the
 * scheme, with its parents, lacks one.
 */
export function terminalPalette(scheme: EditorScheme): TerminalPalette {
  const { colors, attributes } = scheme
  const required = (value: string | undefined, key: string): string => {
    if (value === undefined) throw new Error(`${scheme.name}: no ${key}`)
    return value
  }
  const colour = (key: string) => required(colors[key], key)
  const output = (name: string) => {
    const key = `CONSOLE_${name}_OUTPUT`
    return required(attributes[key]?.foreground, `${key} foreground`)
  }
  return {
    background: colour('CONSOLE_BACKGROUND_KEY'),
    foreground: required(
      attributes.CONSOLE_NORMAL_OUTPUT?.foreground ?? attributes.TEXT?.foreground,
      'CONSOLE_NORMAL_OUTPUT foreground'
    ),
    cursor: colour('CARET_COLOR'),
    selection: colour('SELECTION_BACKGROUND'),
    black: output('BLACK'),
    red: output('RED'),
    green: output('GREEN'),
    yellow: output('YELLOW'),
    blue: output('BLUE'),
    magenta: output('MAGENTA'),
    cyan: output('CYAN'),
    white: output('GRAY'),
    brightBlack: output('DARKGRAY'),
    brightRed: output('RED_BRIGHT'),
    brightGreen: output('GREEN_BRIGHT'),
    brightYellow: output('YELLOW_BRIGHT'),
    brightBlue: output('BLUE_BRIGHT'),
    brightMagenta: output('MAGENTA_BRIGHT'),
    brightCyan: output('CYAN_BRIGHT'),
    brightWhite: output('WHITE')
  }
}
