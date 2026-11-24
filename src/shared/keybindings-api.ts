import type { Notice } from './notice'

/**
 * One entry of keybindings.json, as VS Code writes them: `key` in its key syntax (`ctrl+shift+d`,
 * chords separated by a space), a `-command` removes that command's default key (every key of it
 * when `key` is null).
 */
export type UserKeybinding = {
  key: string | null
  command: string
  when?: string
  args?: unknown
}

export type KeybindingsView = {
  /** The entries in force: the file's usable ones, or the last good ones while it doesn't parse. */
  entries: UserKeybinding[]
  /** What is wrong with keybindings.json (bad entries are ignored), or why it couldn't be read. */
  notice: Notice | null
}

export const KEYBINDINGS_CHANNELS = {
  get: 'keybindings:get',
  changed: 'keybindings:changed',
  openFile: 'keybindings:open-file',
  showFile: 'keybindings:show-file'
} as const

export type KeybindingsApi = {
  getKeybindings: () => Promise<KeybindingsView>
  subscribeKeybindings: (callback: (view: KeybindingsView) => void) => () => void
  /** Creates keybindings.json with every default commented out if it is missing; resolves to its path. */
  openKeybindingsFile: () => Promise<string>
  /** File → Preferences → Open Keybindings (JSON) asks the window to open the file at this path. */
  subscribeShowKeybindingsFile: (callback: (path: string) => void) => () => void
}
