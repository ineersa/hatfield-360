import { acceleratorKeyString } from './key-strings'
import { EDITOR_KEYMAP, editorShortcut, shellActions } from './keymap'
import { isPlainObject } from './plain-object'

/** One entry on one line, spaced as VS Code writes them: `{ "key": "ctrl+d", ... }`. */
const entryText = (entry: Record<string, unknown>): string =>
  `{ ${Object.entries(entry)
    .map(
      ([name, value]) =>
        `${JSON.stringify(name)}: ${
          isPlainObject(value) ? entryText(value) : JSON.stringify(value)
        }`
    )
    .join(', ')} }`

const entryLine = (entry: Record<string, unknown>, name: string): string =>
  `  // ${entryText(entry)}, // ${name}`

/**
 * keybindings.json as the app first writes it: an empty list with every default key on
 * `platform` commented out inside it, so uncommenting a line and changing its key rebinds it.
 */
export function keybindingsTemplate(platform: string): string {
  const editor = EDITOR_KEYMAP.flatMap((binding) => {
    const accelerator = editorShortcut(binding, platform)
    if (accelerator === null) return []
    const entry: Record<string, unknown> = {
      key: acceleratorKeyString(accelerator, platform),
      command: binding.command,
      when: binding.when
    }
    if (binding.args !== undefined) entry['args'] = binding.args
    return [entryLine(entry, binding.action)]
  })
  const shell = shellActions(platform).flatMap(({ id, label, key }) =>
    key === null
      ? []
      : [entryLine({ key: acceleratorKeyString(key, platform), command: id }, label)]
  )
  return [
    '// Hatfield 360 keybindings. Entries here apply on top of the defaults, later ones winning.',
    '// Every default is listed below, commented out: uncomment a line and change its "key" to add',
    '// a key, and put a "-" before a command to remove its default key, as in',
    '//   { "key": "ctrl+d", "command": "-editor.action.duplicateSelection" }',
    '// Keys are written as VS Code writes them: ctrl, shift, alt, cmd (macOS) or meta, then the key;',
    '// editor keys may be two chords, as in "ctrl+k ctrl+c". Editor commands are VS Code commands.',
    '[',
    '  // Editor',
    ...editor,
    '',
    '  // App and terminal',
    ...shell,
    ']',
    ''
  ].join('\n')
}
