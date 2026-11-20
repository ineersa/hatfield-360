import type { ITheme } from '@xterm/xterm'

/** xterm theme keys and the theme roles that colour them. */
const ROLES: [Exclude<keyof ITheme, 'extendedAnsi'>, string][] = [
  ['background', 'background'],
  ['foreground', 'foreground'],
  ['cursor', 'cursor'],
  ['cursorAccent', 'background'],
  ['selectionBackground', 'selection'],
  ['black', 'black'],
  ['red', 'red'],
  ['green', 'green'],
  ['yellow', 'yellow'],
  ['blue', 'blue'],
  ['magenta', 'magenta'],
  ['cyan', 'cyan'],
  ['white', 'white'],
  ['brightBlack', 'bright-black'],
  ['brightRed', 'bright-red'],
  ['brightGreen', 'bright-green'],
  ['brightYellow', 'bright-yellow'],
  ['brightBlue', 'bright-blue'],
  ['brightMagenta', 'bright-magenta'],
  ['brightCyan', 'bright-cyan'],
  ['brightWhite', 'bright-white']
]

/** xterm draws on a canvas and needs colour values, so it reads the active theme's terminal roles. */
export function terminalTheme(element: Element = document.documentElement): ITheme {
  const style = getComputedStyle(element)
  const theme: ITheme = {}
  for (const [key, role] of ROLES) {
    theme[key] = style.getPropertyValue(`--terminal-${role}`).trim()
  }
  return theme
}
