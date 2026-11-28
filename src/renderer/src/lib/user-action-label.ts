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

/** Controls whose name is the app's own wording, such as `Close index.ts` or `Commit`. */
const NAMED_CONTROLS =
  'button,[role=button],[role=tab],[role=menuitem],[role=menuitemcheckbox],[role=checkbox],[role=switch]'
/** Controls named after files, which a log may hold (a Files tree row). */
const FILE_CONTROLS = '[role=treeitem]'
/** Other controls, logged by role only: their names can hold file or chat text (a search result row). */
const OTHER_CONTROLS = 'a,[role=link],[role=option],[role=row],[role=gridcell]'
const MAX_NAME = 80

const named = (role: string, name: string | null | undefined): string | null => {
  const text = (name ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return null
  return `click ${role}"${text.length > MAX_NAME ? `${text.slice(0, MAX_NAME - 1)}…` : text}"`
}

/**
 * A click as the performance log names it: the nearest control by its own name, or by role where
 * the name could be text from a file or a conversation. Text the user reads or writes is never logged.
 */
export function clickActionLabel(target: Element): string {
  if (target.closest('.xterm')) return 'click in a terminal'
  if (target.closest('.monaco-editor')) return 'click in the editor'
  const control = target.closest(`${NAMED_CONTROLS},${FILE_CONTROLS},${OTHER_CONTROLS}`)
  if (control?.matches(NAMED_CONTROLS))
    return (
      named('', control.getAttribute('aria-label') ?? control.textContent) ?? 'click on a button'
    )
  if (control?.matches(FILE_CONTROLS))
    return named('row ', control.getAttribute('aria-label')) ?? 'click on a row'
  if (control) return `click on ${control.getAttribute('role') ?? control.tagName.toLowerCase()}`
  return `click on ${target.tagName.toLowerCase()}`
}

export type UserAction = { label: string; at: number }

/** The last action at or before `time`, with how long before it came; a later one doesn't count. */
export function actionBefore(
  actions: readonly UserAction[],
  time: number
): { label: string; before: number } | null {
  const action = actions.findLast(({ at }) => at <= time)
  return action ? { label: action.label, before: time - action.at } : null
}
