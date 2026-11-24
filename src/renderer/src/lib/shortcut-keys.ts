/** The platform the page runs on, as far as shortcuts care: macOS or not. */
export const rendererPlatform = /Mac/.test(navigator.userAgent) ? 'darwin' : 'other'

export type KeyPress = Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>

/** An Electron accelerator taken apart: the physical key (`KeyboardEvent.code`) and its modifiers. */
export type Shortcut = { code: string; ctrl: boolean; shift: boolean; alt: boolean; meta: boolean }

const NAMED_CODES: Record<string, string> = {
  '/': 'Slash',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '-': 'Minus',
  '=': 'Equal',
  ',': 'Comma',
  '.': 'Period',
  '`': 'Backquote',
  ';': 'Semicolon',
  "'": 'Quote',
  '\\': 'Backslash',
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Left: 'ArrowLeft',
  Right: 'ArrowRight'
}

function keyCode(key: string): string | null {
  if (/^[A-Z]$/.test(key)) return `Key${key}`
  if (/^[0-9]$/.test(key)) return `Digit${key}`
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) return key
  const named = ['Backspace', 'Delete', 'Enter', 'Space', 'Tab', 'Insert', 'Home', 'End', 'Escape']
  if (named.includes(key)) {
    return key
  }
  if (key === 'PageUp' || key === 'PageDown') return key
  return NAMED_CODES[key] ?? null
}

/** `Command+Shift+D` as a key press; throws on a key the table shouldn't hold. */
export function parseShortcut(accelerator: string): Shortcut {
  const parts = accelerator.split('+')
  // `Ctrl+-` splits into an empty last part before the `-`.
  const key = accelerator.endsWith('+-') ? '-' : parts.pop()
  const code = key === undefined ? null : keyCode(key)
  if (code === null) throw new Error(`Unknown key in shortcut ${accelerator}`)
  return {
    code,
    ctrl: parts.includes('Ctrl'),
    shift: parts.includes('Shift'),
    alt: parts.includes('Alt'),
    // Command on macOS; Super, the same key, is how a keybindings.json `meta` reads elsewhere.
    meta: parts.includes('Command') || parts.includes('Super')
  }
}

export function matchesShortcut(event: KeyPress, accelerator: string | null): boolean {
  if (accelerator === null) return false
  const shortcut = parseShortcut(accelerator)
  return (
    shortcut.code === event.code &&
    shortcut.ctrl === event.ctrlKey &&
    shortcut.shift === event.shiftKey &&
    shortcut.alt === event.altKey &&
    shortcut.meta === event.metaKey
  )
}

const MAC_SYMBOLS: [string, string][] = [
  ['Ctrl+', '⌃'],
  ['Alt+', '⌥'],
  ['Shift+', '⇧'],
  ['Command+', '⌘']
]

/** A shortcut as people read it: `⌃⌥⇧⌘D` on macOS (Apple's modifier order), `Ctrl+Shift+D` elsewhere. */
export function shortcutLabel(accelerator: string, platform: string): string {
  if (platform !== 'darwin') return accelerator
  let rest = accelerator
  let symbols = ''
  for (const [name, symbol] of MAC_SYMBOLS) {
    if (rest.includes(name)) {
      symbols += symbol
      rest = rest.replace(name, '')
    }
  }
  return symbols + rest
}
