/** What a right-click landed on, as the text items of its menu need it. */
export type TextMenuTarget = {
  /** The field the click was in, when it takes typing. */
  field: HTMLInputElement | HTMLTextAreaElement | HTMLElement | null
  /** The text selected when the menu opened; empty when nothing was. */
  selection: string
  /** What Select All selects when the click wasn't in a field: the panel or dialog clicked. */
  scope: Element
}

/** Select All stays inside the panel or dialog clicked, or a narrower `data-text-scope`. */
const SCOPES = '[data-text-scope], [role=dialog], [role=alertdialog], aside, main, footer'

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'email', 'tel', 'number', 'password'])

function editableField(element: Element | null): TextMenuTarget['field'] {
  const field = element?.closest('input, textarea, [contenteditable]')
  if (field instanceof HTMLTextAreaElement) return field.disabled ? null : field
  if (field instanceof HTMLInputElement) {
    return field.disabled || !TEXT_INPUT_TYPES.has(field.type) ? null : field
  }
  return field instanceof HTMLElement && field.isContentEditable ? field : null
}

function isTextControl(field: Element | null): field is HTMLInputElement | HTMLTextAreaElement {
  return field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement
}

/** Whether Cut and Paste may change the field. */
export function isWritable(field: TextMenuTarget['field']): field is HTMLElement {
  return field !== null && !(isTextControl(field) && field.readOnly)
}

/** Whether there is text to copy; a password's never leaves its field. */
export function isCopyable(target: TextMenuTarget): boolean {
  const password = target.field instanceof HTMLInputElement && target.field.type === 'password'
  return target.selection !== '' && !password
}

/** The target of a right-click on `element`, inside `fallbackScope` (the menu's trigger). */
export function textMenuTarget(element: Element | null, fallbackScope: Element): TextMenuTarget {
  const field = editableField(element)
  const selection =
    isTextControl(field) && field.selectionStart !== null && field.selectionEnd !== null
      ? field.value.slice(field.selectionStart, field.selectionEnd)
      : (window.getSelection()?.toString() ?? '')
  const scope = element?.closest(SCOPES) ?? fallbackScope
  return { field, selection, scope }
}

/** Selects all of the field's text, or all text in the target's scope. */
export function selectAllText(target: TextMenuTarget): void {
  const { field, scope } = target
  if (isTextControl(field)) {
    field.focus()
    field.select()
    return
  }
  field?.focus()
  const range = document.createRange()
  range.selectNodeContents(field ?? scope)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}
