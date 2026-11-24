/**
 * Keys as keybindings.json writes them, VS Code's way (`ctrl+shift+d`, chords as `ctrl+k ctrl+c`),
 * and as the app's keymap holds them: Electron accelerators (`Ctrl+Shift+D`). The meta key is
 * Command on macOS (`cmd`) and Super elsewhere (`meta`).
 */

const NAMED_KEYS: Record<string, string> = {
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  home: 'Home',
  end: 'End',
  insert: 'Insert',
  delete: 'Delete',
  backspace: 'Backspace',
  enter: 'Enter',
  space: 'Space',
  tab: 'Tab',
  escape: 'Escape'
}
const PUNCTUATION = new Set(['/', '[', ']', '-', '=', ',', '.', '`', ';', "'", '\\'])

function acceleratorKey(key: string): string | null {
  if (/^[a-z]$/.test(key)) return key.toUpperCase()
  if (/^[0-9]$/.test(key)) return key
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(key)) return key.toUpperCase()
  if (PUNCTUATION.has(key)) return key
  return NAMED_KEYS[key] ?? null
}

/** One chord (`ctrl+shift+d`) as an accelerator, or null if it isn't a key the app knows. */
function chordAccelerator(chord: string, platform: string): string | null {
  // `ctrl+-` and `ctrl++`: the key is whatever follows the last modifier's `+`.
  const match = /^((?:[a-z]+\+)*)(.+)$/.exec(chord.toLowerCase())
  if (!match) return null
  const modifiers = (match[1] ?? '').split('+').filter((part) => part !== '')
  const key = acceleratorKey(match[2] ?? '')
  if (key === null) return null
  const parts = new Set<string>()
  for (const modifier of modifiers) {
    if (modifier === 'ctrl') parts.add('Ctrl')
    else if (modifier === 'shift') parts.add('Shift')
    else if (modifier === 'alt') parts.add('Alt')
    else if (modifier === 'cmd' || modifier === 'meta' || modifier === 'win') {
      parts.add(platform === 'darwin' ? 'Command' : 'Super')
    } else return null
  }
  const ordered = ['Ctrl', 'Command', 'Super', 'Alt', 'Shift'].filter((part) => parts.has(part))
  return [...ordered, key].join('+')
}

/** `ctrl+k ctrl+c` as accelerators, one per chord; null if any chord isn't readable. */
export function keyStringAccelerators(keys: string, platform: string): string[] | null {
  const chords = keys.trim().split(/\s+/)
  if (chords.length === 0 || chords.length > 2 || chords[0] === '') return null
  const accelerators = chords.map((chord) => chordAccelerator(chord, platform))
  return accelerators.every((accelerator) => accelerator !== null) ? accelerators : null
}

/** An accelerator written as keybindings.json writes keys: `Command+Shift+D` is `shift+cmd+d`. */
export function acceleratorKeyString(accelerator: string, platform: string): string {
  const parts = accelerator.split('+')
  // `Ctrl+-` splits into an empty last part before the `-`.
  const key = accelerator.endsWith('+-') ? '-' : (parts.at(-1) ?? '')
  const has = (name: string): boolean => parts.slice(0, -1).includes(name)
  const meta = has('Command') || has('Super')
  return [
    has('Ctrl') ? 'ctrl' : null,
    has('Shift') ? 'shift' : null,
    has('Alt') ? 'alt' : null,
    meta ? (platform === 'darwin' ? 'cmd' : 'meta') : null,
    key.toLowerCase()
  ]
    .filter((part) => part !== null)
    .join('+')
}
