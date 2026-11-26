import { acceleratorKeyString, keyStringAccelerators } from './key-strings'
import type { UserKeybinding } from './keybindings-api'
import { TERMINAL_COMMANDS, type TerminalCommand } from './terminal-api'

/**
 * Every shortcut in the app, after JetBrains' default keymaps: "macOS" on macOS, "Default for
 * XWin" elsewhere. Keys are Electron accelerators (`Command`, `Ctrl`, `Alt`, `Shift`, then a key);
 * null where a platform has no key for the action.
 */
type Keys = { mac: string | null; other: string | null }

/** Where an editor key applies, as a VS Code context expression. */
const EDIT = 'editorTextFocus && !editorReadonly'
const TEXT = 'editorTextFocus'
const EDITOR = 'editorFocus'

export type EditorBinding = Keys & {
  /** The JetBrains action, by its keymap name. */
  action: string
  /** The VS Code command it runs, or one of ours (`hatfield.*`). */
  command: string
  args?: Record<string, unknown>
  when: string
}

/** The editor's keys, registered with VS Code's keybinding service in place of its defaults on them. */
export const EDITOR_KEYMAP: readonly EditorBinding[] = [
  // Editing
  {
    action: 'EditorDuplicate',
    command: 'editor.action.duplicateSelection',
    mac: 'Command+D',
    other: 'Ctrl+D',
    when: EDIT
  },
  {
    action: 'EditorDeleteLine',
    command: 'editor.action.deleteLines',
    mac: 'Command+Backspace',
    other: 'Ctrl+Y',
    when: EDIT
  },
  {
    action: 'CommentByLineComment',
    command: 'editor.action.commentLine',
    mac: 'Command+/',
    other: 'Ctrl+/',
    when: EDIT
  },
  {
    action: 'CommentByBlockComment',
    command: 'editor.action.blockComment',
    mac: 'Command+Alt+/',
    other: 'Ctrl+Shift+/',
    when: EDIT
  },
  {
    action: 'MoveLineUp',
    command: 'editor.action.moveLinesUpAction',
    mac: 'Alt+Shift+Up',
    other: 'Alt+Shift+Up',
    when: EDIT
  },
  {
    action: 'MoveLineDown',
    command: 'editor.action.moveLinesDownAction',
    mac: 'Alt+Shift+Down',
    other: 'Alt+Shift+Down',
    when: EDIT
  },
  // VS Code moves lines, not statements; the keys still move the caret's lines.
  {
    action: 'MoveStatementUp',
    command: 'editor.action.moveLinesUpAction',
    mac: 'Command+Shift+Up',
    other: 'Ctrl+Shift+Up',
    when: EDIT
  },
  {
    action: 'MoveStatementDown',
    command: 'editor.action.moveLinesDownAction',
    mac: 'Command+Shift+Down',
    other: 'Ctrl+Shift+Down',
    when: EDIT
  },
  {
    action: 'EditorJoinLines',
    command: 'editor.action.joinLines',
    mac: 'Ctrl+Shift+J',
    other: 'Ctrl+Shift+J',
    when: EDIT
  },
  {
    action: 'EditorStartNewLine',
    command: 'editor.action.insertLineAfter',
    mac: 'Shift+Enter',
    other: 'Shift+Enter',
    when: `${EDIT} && !suggestWidgetVisible`
  },
  {
    action: 'EditorStartNewLineBefore',
    command: 'editor.action.insertLineBefore',
    mac: 'Command+Alt+Enter',
    other: 'Ctrl+Alt+Enter',
    when: EDIT
  },
  { action: '$Redo', command: 'redo', mac: 'Command+Shift+Z', other: 'Ctrl+Shift+Z', when: EDIT },
  {
    action: 'AutoIndentLines',
    command: 'editor.action.reindentselectedlines',
    mac: 'Ctrl+Alt+I',
    other: 'Ctrl+Alt+I',
    when: EDIT
  },
  {
    action: 'ReformatCode',
    command: 'editor.action.formatDocument',
    mac: 'Command+Alt+L',
    other: 'Ctrl+Alt+L',
    when: `${EDIT} && !editorHasSelection`
  },
  {
    action: 'ReformatCode',
    command: 'editor.action.formatSelection',
    mac: 'Command+Alt+L',
    other: 'Ctrl+Alt+L',
    when: `${EDIT} && editorHasSelection`
  },
  {
    action: 'OptimizeImports',
    command: 'editor.action.organizeImports',
    mac: 'Ctrl+Alt+O',
    other: 'Ctrl+Alt+O',
    when: EDIT
  },
  {
    action: 'RenameElement',
    command: 'editor.action.rename',
    mac: 'Shift+F6',
    other: 'Shift+F6',
    when: EDIT
  },
  {
    action: 'ShowIntentionActions',
    command: 'editor.action.quickFix',
    mac: 'Alt+Enter',
    other: 'Alt+Enter',
    when: EDIT
  },
  {
    action: 'CodeCompletion',
    command: 'editor.action.triggerSuggest',
    mac: 'Ctrl+Space',
    other: 'Ctrl+Space',
    when: EDIT
  },
  {
    action: 'SmartTypeCompletion',
    command: 'editor.action.triggerSuggest',
    mac: 'Ctrl+Shift+Space',
    other: 'Ctrl+Shift+Space',
    when: EDIT
  },
  {
    action: 'ParameterInfo',
    command: 'editor.action.triggerParameterHints',
    mac: 'Command+P',
    other: 'Ctrl+P',
    when: EDIT
  },
  { action: 'SaveAll', command: 'hatfield.save', mac: 'Command+S', other: 'Ctrl+S', when: EDITOR },

  // Selection and carets
  {
    action: 'EditorSelectWord',
    command: 'editor.action.smartSelect.expand',
    mac: 'Alt+Up',
    other: 'Ctrl+W',
    when: TEXT
  },
  {
    action: 'EditorUnSelectWord',
    command: 'editor.action.smartSelect.shrink',
    mac: 'Alt+Down',
    other: 'Ctrl+Shift+W',
    when: TEXT
  },
  {
    action: 'SelectNextOccurrence',
    command: 'editor.action.addSelectionToNextFindMatch',
    mac: 'Ctrl+G',
    other: 'Alt+J',
    when: EDITOR
  },
  {
    action: 'UnselectPreviousOccurrence',
    command: 'cursorUndo',
    mac: 'Ctrl+Shift+G',
    other: 'Alt+Shift+J',
    when: TEXT
  },
  {
    action: 'SelectAllOccurrences',
    command: 'editor.action.selectHighlights',
    mac: 'Ctrl+Command+G',
    other: 'Ctrl+Alt+Shift+J',
    when: EDITOR
  },
  {
    action: 'EditorMatchBrace',
    command: 'editor.action.jumpToBracket',
    mac: 'Ctrl+M',
    other: 'Ctrl+Shift+M',
    when: TEXT
  },
  {
    action: 'EditorMoveToPageTop',
    command: 'cursorMove',
    args: { to: 'viewPortTop' },
    mac: 'Command+PageUp',
    other: 'Ctrl+PageUp',
    when: TEXT
  },
  {
    action: 'EditorMoveToPageBottom',
    command: 'cursorMove',
    args: { to: 'viewPortBottom' },
    mac: 'Command+PageDown',
    other: 'Ctrl+PageDown',
    when: TEXT
  },
  {
    action: 'EditorMoveToPageTopWithSelection',
    command: 'cursorMove',
    args: { to: 'viewPortTop', select: true },
    mac: 'Command+Shift+PageUp',
    other: 'Ctrl+Shift+PageUp',
    when: TEXT
  },
  {
    action: 'EditorMoveToPageBottomWithSelection',
    command: 'cursorMove',
    args: { to: 'viewPortBottom', select: true },
    mac: 'Command+Shift+PageDown',
    other: 'Ctrl+Shift+PageDown',
    when: TEXT
  },

  // Navigation
  {
    action: 'GotoDeclaration',
    command: 'editor.action.revealDefinition',
    mac: 'Command+B',
    other: 'Ctrl+B',
    when: TEXT
  },
  {
    action: 'GotoImplementation',
    command: 'editor.action.goToImplementation',
    mac: 'Command+Alt+B',
    other: 'Ctrl+Alt+B',
    when: TEXT
  },
  {
    action: 'GotoTypeDeclaration',
    command: 'editor.action.goToTypeDefinition',
    mac: 'Command+Shift+B',
    other: 'Ctrl+Shift+B',
    when: TEXT
  },
  {
    action: 'QuickImplementations',
    command: 'editor.action.peekDefinition',
    mac: 'Command+Y',
    other: 'Ctrl+Shift+I',
    when: TEXT
  },
  {
    action: 'FindUsages',
    command: 'editor.action.goToReferences',
    mac: 'Alt+F7',
    other: 'Alt+F7',
    when: TEXT
  },
  {
    action: 'ShowUsages',
    command: 'editor.action.referenceSearch.trigger',
    mac: 'Command+Alt+F7',
    other: 'Ctrl+Alt+F7',
    when: TEXT
  },
  {
    action: 'HighlightUsagesInFile',
    command: 'editor.action.wordHighlight.trigger',
    mac: 'Command+Shift+F7',
    other: 'Ctrl+Shift+F7',
    when: TEXT
  },
  {
    action: 'QuickJavaDoc',
    command: 'editor.action.showHover',
    mac: 'F1',
    other: 'Ctrl+Q',
    when: TEXT
  },
  {
    action: 'ShowErrorDescription',
    command: 'editor.action.showHover',
    mac: 'Command+F1',
    other: 'Ctrl+F1',
    when: TEXT
  },
  {
    action: 'GotoNextError',
    command: 'editor.action.marker.next',
    mac: 'F2',
    other: 'F2',
    when: TEXT
  },
  {
    action: 'GotoPreviousError',
    command: 'editor.action.marker.prev',
    mac: 'Shift+F2',
    other: 'Shift+F2',
    when: TEXT
  },
  {
    action: 'GotoLine',
    command: 'workbench.action.gotoLine',
    mac: 'Command+L',
    other: 'Ctrl+G',
    when: EDITOR
  },
  {
    action: 'FileStructurePopup',
    command: 'workbench.action.gotoSymbol',
    mac: 'Command+F12',
    other: 'Ctrl+F12',
    when: TEXT
  },
  // VS Code's command palette lists the editor's actions: Find Action for the editor until the app has one.
  {
    action: 'GotoAction',
    command: 'workbench.action.showCommands',
    mac: 'Command+Shift+A',
    other: 'Ctrl+Shift+A',
    when: EDITOR
  },

  // Find
  {
    action: 'Replace',
    command: 'editor.action.startFindReplaceAction',
    mac: 'Command+R',
    other: 'Ctrl+R',
    when: EDITOR
  },
  {
    action: 'FindNext',
    command: 'editor.action.nextMatchFindAction',
    mac: 'Command+G',
    other: 'F3',
    when: EDITOR
  },
  {
    action: 'FindPrevious',
    command: 'editor.action.previousMatchFindAction',
    mac: 'Command+Shift+G',
    other: 'Shift+F3',
    when: EDITOR
  },

  // Folding
  {
    action: 'CollapseRegion',
    command: 'editor.fold',
    mac: 'Command+-',
    other: 'Ctrl+-',
    when: TEXT
  },
  {
    action: 'ExpandRegion',
    command: 'editor.unfold',
    mac: 'Command+=',
    other: 'Ctrl+=',
    when: TEXT
  },
  {
    action: 'CollapseRegionRecursively',
    command: 'editor.foldRecursively',
    mac: 'Command+Alt+-',
    other: 'Ctrl+Alt+-',
    when: TEXT
  },
  {
    action: 'ExpandRegionRecursively',
    command: 'editor.unfoldRecursively',
    mac: 'Command+Alt+=',
    other: 'Ctrl+Alt+=',
    when: TEXT
  },
  {
    action: 'CollapseAllRegions',
    command: 'editor.foldAll',
    mac: 'Command+Shift+-',
    other: 'Ctrl+Shift+-',
    when: TEXT
  },
  {
    action: 'ExpandAllRegions',
    command: 'editor.unfoldAll',
    mac: 'Command+Shift+=',
    other: 'Ctrl+Shift+=',
    when: TEXT
  },
  {
    action: 'CollapseSelection',
    command: 'editor.createFoldingRangeFromSelection',
    mac: 'Command+.',
    other: 'Ctrl+.',
    when: TEXT
  }
]

/** An app or terminal action: its keybindings.json command id, name and keys. */
type ShellAction = Keys & { id: string; label: string }

/**
 * macOS uses Command; Linux adds Shift (or Alt) because Ctrl+letter belongs to the shell
 * (Ctrl+W deletes a word, Ctrl+D ends input). Except New Terminal they act only on terminals on
 * screen, which the editor never shares it with, so a key both use goes to whichever is shown.
 */
const TERMINAL_KEYMAP: Record<TerminalCommand, ShellAction> = {
  'new-terminal': {
    id: 'hatfield.terminal.newTerminal',
    label: 'New Terminal',
    mac: 'Command+T',
    other: 'Ctrl+Shift+T'
  },
  'split-right': {
    id: 'hatfield.terminal.splitRight',
    label: 'Split Right',
    mac: 'Command+D',
    other: 'Ctrl+Shift+D'
  },
  'split-down': {
    id: 'hatfield.terminal.splitDown',
    label: 'Split Down',
    mac: 'Command+Shift+D',
    other: 'Alt+Shift+D'
  },
  'close-pane': {
    id: 'hatfield.terminal.closePane',
    label: 'Close Pane',
    mac: 'Command+W',
    other: 'Ctrl+Shift+W'
  },
  'focus-next-pane': {
    id: 'hatfield.terminal.focusNextPane',
    label: 'Focus Next Pane',
    mac: 'Command+]',
    other: 'Ctrl+Shift+]'
  },
  'focus-previous-pane': {
    id: 'hatfield.terminal.focusPreviousPane',
    label: 'Focus Previous Pane',
    mac: 'Command+[',
    other: 'Ctrl+Shift+['
  },
  'next-tab': {
    id: 'hatfield.terminal.nextTab',
    label: 'Next Terminal Tab',
    mac: 'Command+Shift+]',
    other: 'Ctrl+PageDown'
  },
  'previous-tab': {
    id: 'hatfield.terminal.previousTab',
    label: 'Previous Terminal Tab',
    mac: 'Command+Shift+[',
    other: 'Ctrl+PageUp'
  }
}

export const APP_COMMANDS = [
  'open-folder',
  'save',
  'settings',
  'close-window',
  'close-editor-tab',
  'next-editor-tab',
  'previous-editor-tab',
  'copy-absolute-path',
  'copy-relative-path',
  'select-opened-file',
  'find-in-files',
  'search-everywhere',
  'go-to-file',
  'go-to-class',
  'go-to-symbol',
  'new-chat'
] as const
export type AppCommand = (typeof APP_COMMANDS)[number]

/** The app's own actions: menu accelerators, and keys the editor tabs and file tree handle. */
const APP_KEYMAP: Record<AppCommand, ShellAction> = {
  // JetBrains has no key for Open; Command+O is Go to Class on macOS.
  'open-folder': {
    id: 'hatfield.openFolder',
    label: 'Open Folder',
    mac: null,
    other: 'Ctrl+O'
  },
  // The editor runs the same command on the same key while it has the keys.
  save: { id: 'hatfield.save', label: 'Save', mac: 'Command+S', other: 'Ctrl+S' },
  settings: { id: 'hatfield.settings', label: 'Settings', mac: 'Command+,', other: 'Ctrl+Alt+S' },
  // Command+W closes the editor tab or terminal pane, as in JetBrains IDEs and iTerm.
  'close-window': {
    id: 'hatfield.closeWindow',
    label: 'Close Window',
    mac: 'Command+Shift+W',
    other: null
  },
  'close-editor-tab': {
    id: 'hatfield.editor.closeTab',
    label: 'Close Tab',
    mac: 'Command+W',
    other: 'Ctrl+F4'
  },
  'next-editor-tab': {
    id: 'hatfield.editor.nextTab',
    label: 'Select Next Tab',
    mac: 'Command+Shift+]',
    other: 'Alt+Right'
  },
  'previous-editor-tab': {
    id: 'hatfield.editor.previousTab',
    label: 'Select Previous Tab',
    mac: 'Command+Shift+[',
    other: 'Alt+Left'
  },
  'copy-absolute-path': {
    id: 'hatfield.files.copyPath',
    label: 'Copy Path',
    mac: 'Command+Shift+C',
    other: 'Ctrl+Shift+C'
  },
  'copy-relative-path': {
    id: 'hatfield.files.copyRelativePath',
    label: 'Copy Relative Path',
    mac: 'Command+Alt+Shift+C',
    other: 'Ctrl+Alt+Shift+C'
  },
  // JetBrains' Project view button has no key of its own.
  'select-opened-file': {
    id: 'hatfield.files.selectOpenedFile',
    label: 'Select Opened File',
    mac: null,
    other: null
  },
  'find-in-files': {
    id: 'hatfield.search.findInFiles',
    label: 'Find in Files',
    mac: 'Command+Shift+F',
    other: 'Ctrl+Shift+F'
  },
  // Shift pressed twice opens it too, as in JetBrains; that isn't a key keybindings.json can name.
  'search-everywhere': {
    id: 'hatfield.search.searchEverywhere',
    label: 'Search Everywhere',
    mac: null,
    other: null
  },
  'go-to-file': {
    id: 'hatfield.search.goToFile',
    label: 'Go to File',
    mac: 'Command+Shift+O',
    other: 'Ctrl+Shift+N'
  },
  'go-to-class': {
    id: 'hatfield.search.goToClass',
    label: 'Go to Class',
    mac: 'Command+O',
    other: 'Ctrl+N'
  },
  'go-to-symbol': {
    id: 'hatfield.search.goToSymbol',
    label: 'Go to Symbol',
    mac: 'Command+Alt+O',
    other: 'Ctrl+Alt+Shift+N'
  },
  // Taken from a focused terminal too, where Ctrl+\ would otherwise send SIGQUIT.
  'new-chat': { id: 'hatfield.chat.new', label: 'New Chat', mac: 'Command+\\', other: 'Ctrl+\\' }
}

const pick = (keys: Keys, platform: string): string | null =>
  platform === 'darwin' ? keys.mac : keys.other

export function editorShortcut(binding: EditorBinding, platform: string): string | null {
  return pick(binding, platform)
}

type ShellCommand =
  | { kind: 'app'; command: AppCommand }
  | { kind: 'terminal'; command: TerminalCommand }

/** An app or terminal command and one key that runs it. */
type ShellBinding = ShellCommand & { key: string }

/** The app's and terminals' keys in force: each key bound to at most one app and one terminal command. */
export type ShellKeymap = readonly ShellBinding[]

const SHELL_ACTIONS: { command: ShellCommand; action: ShellAction }[] = [
  ...TERMINAL_COMMANDS.map((command) => ({
    command: { kind: 'terminal', command } as const,
    action: TERMINAL_KEYMAP[command]
  })),
  ...APP_COMMANDS.map((command) => ({
    command: { kind: 'app', command } as const,
    action: APP_KEYMAP[command]
  }))
]

/** The app or terminal command a keybindings.json command id names, if any. */
export function shellCommand(id: string): ShellCommand | null {
  return SHELL_ACTIONS.find(({ action }) => action.id === id)?.command ?? null
}

/** Every app and terminal action: its command id, name and default key on `platform`. */
export function shellActions(
  platform: string
): { id: string; label: string; key: string | null }[] {
  return SHELL_ACTIONS.map(({ action }) => ({
    id: action.id,
    label: action.label,
    key: pick(action, platform)
  }))
}

/** The app's default keys with the user's keybindings.json entries applied in order. */
export function shellKeymap(
  platform: string,
  entries: readonly UserKeybinding[] = []
): ShellKeymap {
  // Compared in one form, whatever order their modifiers were written in.
  const normal = (accelerator: string): string | undefined =>
    keyStringAccelerators(acceleratorKeyString(accelerator, platform), platform)?.[0]
  let bindings: ShellBinding[] = SHELL_ACTIONS.flatMap(({ command, action }) => {
    const key = pick(action, platform)
    return key === null ? [] : [{ ...command, key }]
  })
  for (const entry of entries) {
    const removal = entry.command.startsWith('-')
    const target = shellCommand(removal ? entry.command.slice(1) : entry.command)
    if (!target) continue
    const keys = entry.key === null ? null : keyStringAccelerators(entry.key, platform)
    // The app's keys are single chords; a chord sequence binds only editor commands.
    if (entry.key !== null && keys?.length !== 1) continue
    const key = keys?.[0]
    if (removal) {
      bindings = bindings.filter(
        (binding) =>
          binding.kind !== target.kind ||
          binding.command !== target.command ||
          (key !== undefined && normal(binding.key) !== normal(key))
      )
    } else if (key !== undefined) {
      // A key runs one app command and one terminal command (never on screen together): the latest.
      bindings = bindings.filter(
        (binding) => binding.kind !== target.kind || normal(binding.key) !== normal(key)
      )
      bindings.push({ ...target, key })
    }
  }
  return bindings
}

/** The key an app command shows and answers to: the last one bound. */
export function appShortcut(keymap: ShellKeymap, command: AppCommand): string | null {
  return (
    keymap.findLast((binding) => binding.kind === 'app' && binding.command === command)?.key ?? null
  )
}

export function terminalShortcut(keymap: ShellKeymap, command: TerminalCommand): string | null {
  return (
    keymap.findLast((binding) => binding.kind === 'terminal' && binding.command === command)?.key ??
    null
  )
}
