export type KeyAction = Pick<
  KeyboardEvent,
  'key' | 'code' | 'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey'
>

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock', 'Dead'])

/** `KeyW` as `W`, `Digit1` as `1`; other codes as they are. */
const codeName = (code: string): string => code.replace(/^(?:Key|Digit)/, '')

/**
 * A key press as the performance log names it: a shortcut or a named key, and `typing` for any
 * character, so what the user types never reaches the log. Null for a modifier pressed alone.
 */
export function keyActionLabel(event: KeyAction): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null
  const command = event.ctrlKey || event.metaKey
  // Option composes characters on macOS, so Alt with a character is still typing.
  if (event.key.length === 1 && !command) return 'typing'
  const modifiers = [
    event.ctrlKey ? 'Ctrl+' : '',
    event.altKey ? 'Alt+' : '',
    event.shiftKey ? 'Shift+' : '',
    event.metaKey ? 'Meta+' : ''
  ].join('')
  return `key ${modifiers}${event.key.length === 1 ? codeName(event.code) : event.key}`
}

const NAMED_ROLES = '[aria-label],button,[role],a'
const MAX_NAME = 80

/** A click as the performance log names it: the nearest named control, never the text of a terminal or editor. */
export function clickActionLabel(target: Element): string {
  if (target.closest('.xterm')) return 'click in a terminal'
  if (target.closest('.monaco-editor')) return 'click in the editor'
  const control = target.closest(NAMED_ROLES)
  const name = (control?.getAttribute('aria-label') ?? control?.textContent ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!control || !name) return `click on ${target.tagName.toLowerCase()}`
  return `click "${name.length > MAX_NAME ? `${name.slice(0, MAX_NAME - 1)}…` : name}"`
}
