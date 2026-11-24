import { decodeKeybinding } from '@codingame/monaco-vscode-api/vscode/vs/base/common/keybindings'
import { OS } from '@codingame/monaco-vscode-api/vscode/vs/base/common/platform'
import { CommandsRegistry } from '@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands'
import { ContextKeyExpr } from '@codingame/monaco-vscode-api/vscode/vs/platform/contextkey/common/contextkey'
import { KeybindingsRegistry } from '@codingame/monaco-vscode-api/vscode/vs/platform/keybinding/common/keybindingsRegistry'
import { parseShortcut, rendererPlatform } from '@/lib/shortcut-keys'
import { useKeymapStore } from '@/state/keymap-store'
import { notify } from '@/state/notification-store'
import { keyStringAccelerators } from '../../../../shared/key-strings'
import type { UserKeybinding } from '../../../../shared/keybindings-api'
import {
  EDITOR_KEYMAP,
  editorShortcut,
  shellCommand,
  type ShellKeymap
} from '../../../../shared/keymap'
import { monaco } from './monaco-environment'

/** Monaco's key code names differ from `KeyboardEvent.code` for the arrows only. */
const ARROWS: Record<string, keyof typeof monaco.KeyCode> = {
  ArrowUp: 'UpArrow',
  ArrowDown: 'DownArrow',
  ArrowLeft: 'LeftArrow',
  ArrowRight: 'RightArrow'
}

function isKeyCodeName(name: string): name is keyof typeof monaco.KeyCode {
  return name in monaco.KeyCode
}

/**
 * An Electron accelerator as a Monaco keybinding: `CtrlCmd` is Command on macOS, Ctrl elsewhere;
 * null for a key Monaco has no code for.
 */
function monacoKeybinding(accelerator: string): number | null {
  const shortcut = parseShortcut(accelerator)
  const name = ARROWS[shortcut.code] ?? shortcut.code
  if (!isKeyCodeName(name)) return null
  const mac = rendererPlatform === 'darwin'
  const { KeyMod } = monaco
  const command = mac ? shortcut.meta : shortcut.ctrl
  const control = mac ? shortcut.ctrl : shortcut.meta
  return (
    monaco.KeyCode[name] |
    (command ? KeyMod.CtrlCmd : 0) |
    (control ? KeyMod.WinCtrl : 0) |
    (shortcut.shift ? KeyMod.Shift : 0) |
    (shortcut.alt ? KeyMod.Alt : 0)
  )
}

/** A keybindings.json key (one chord or two) as a Monaco keybinding; null if unreadable. */
function userKeybinding(keys: string): number | null {
  const [first, second, ...rest] = (keyStringAccelerators(keys, rendererPlatform) ?? []).map(
    monacoKeybinding
  )
  if (first === undefined || first === null || second === null || rest.length > 0) return null
  return second === undefined ? first : monaco.KeyMod.chord(first, second)
}

const WIDGET_CONTEXT = /Visible|Focussed|inReferenceSearchEditor|inSnippetMode/

const chordOf = (keybinding: number): string | undefined =>
  decodeKeybinding(keybinding, OS)?.chords[0]?.getHashCode()

/** Above every VS Code default, so ours win on a key both bind. */
const JETBRAINS_WEIGHT = 1000

/** Our editor keys, as Monaco keybindings, with the chord each starts with. */
const editorRules = EDITOR_KEYMAP.flatMap((binding) => {
  const accelerator = editorShortcut(binding, rendererPlatform)
  const keybinding = accelerator === null ? null : monacoKeybinding(accelerator)
  if (keybinding === null) return []
  return [{ binding, keybinding, chord: chordOf(keybinding) }]
})

/**
 * VS Code's defaults on every key our editor or app keys claim, removed, so where a JetBrains key
 * doesn't apply (Ctrl+D in a read-only file) VS Code's action doesn't run in its place, and app
 * keys reach the app.
 */
function defaultRemovals(shell: ShellKeymap): monaco.editor.IKeybindingRule[] {
  const claimed = new Map<string, number>()
  const appKeys = shell.flatMap((binding) => {
    const keybinding = binding.kind === 'app' ? monacoKeybinding(binding.key) : null
    return keybinding === null ? [] : [keybinding]
  })
  for (const keybinding of [...editorRules.map((rule) => rule.keybinding), ...appKeys]) {
    const chord = chordOf(keybinding)
    if (chord !== undefined) claimed.set(chord, keybinding)
  }
  return KeybindingsRegistry.getDefaultKeybindings().flatMap((item) => {
    const chord = item.keybinding?.chords[0]?.getHashCode()
    const keybinding = chord === undefined ? undefined : claimed.get(chord)
    if (keybinding === undefined || !item.command || item.command.startsWith('-')) return []
    // Keys of an open widget (suggestions, find, rename, peek) stay: they act on the widget, not the text.
    if (WIDGET_CONTEXT.test(item.when?.serialize() ?? '')) return []
    // A removal would take our own default of the same command on the key with it.
    if (editorRules.some((rule) => rule.chord === chord && rule.binding.command === item.command)) {
      return []
    }
    return [{ keybinding, command: `-${item.command}` }]
  })
}

/** keybindings.json's entries the editor runs: all but the app's and terminals' own commands. */
function userRules(entries: readonly UserKeybinding[]): monaco.editor.IKeybindingRule[] {
  return entries.flatMap((entry) => {
    const id = entry.command.replace(/^-/, '')
    if (id !== 'hatfield.save' && shellCommand(id)) return []
    const keybinding = entry.key === null ? 0 : userKeybinding(entry.key)
    if (keybinding === null) return []
    if (!entry.command.startsWith('-') && !CommandsRegistry.getCommand(id)) {
      notify({
        severity: 'warning',
        title: 'Keybindings',
        body: `keybindings.json binds ${entry.key ?? 'no key'} to ${id}, which the editor doesn't have.`
      })
      return []
    }
    return [
      {
        keybinding,
        command: entry.command,
        ...(entry.when === undefined ? {} : { when: entry.when }),
        ...(entry.args === undefined ? {} : { commandArgs: entry.args })
      }
    ]
  })
}

/**
 * The editor's JetBrains keys, as defaults a keybindings.json `-command` can remove, then the
 * user's entries over them, replaced whenever keybindings.json changes.
 */
export function installEditorKeymap(save: () => void): void {
  monaco.editor.registerCommand('hatfield.save', save)
  for (const { binding, keybinding } of editorRules) {
    if (!CommandsRegistry.getCommand(binding.command)) {
      console.error(`Editor keymap: ${binding.action} runs ${binding.command}, which doesn't exist`)
    }
    KeybindingsRegistry.registerKeybindingRule({
      id: binding.command,
      primary: keybinding,
      weight: JETBRAINS_WEIGHT,
      args: binding.args,
      when: ContextKeyExpr.deserialize(binding.when)
    })
  }
  let applied: monaco.IDisposable | null = null
  const apply = ({
    entries,
    shell
  }: {
    entries: readonly UserKeybinding[]
    shell: ShellKeymap
  }) => {
    applied?.dispose()
    // Adding them also rebuilds the resolver, which picks up the defaults registered above.
    applied = monaco.editor.addKeybindingRules([...defaultRemovals(shell), ...userRules(entries)])
  }
  apply(useKeymapStore.getState())
  useKeymapStore.subscribe((state, previous) => {
    if (state.entries !== previous.entries) apply(state)
  })
}
