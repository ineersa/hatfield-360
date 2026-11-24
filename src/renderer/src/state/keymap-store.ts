import { create } from 'zustand'
import { mainErrorMessage } from '@/lib/main-error-message'
import { rendererPlatform } from '@/lib/shortcut-keys'
import { useEditorTabStore } from '@/state/editor-tab-store'
import { followNotice, notify } from '@/state/notification-store'
import { useShellLayoutStore } from '@/state/shell-layout-store'
import type { KeybindingsView, UserKeybinding } from '../../../shared/keybindings-api'
import { shellKeymap, type ShellKeymap } from '../../../shared/keymap'

type KeymapState = {
  /** keybindings.json's entries in force; empty until main answers, so the defaults apply. */
  entries: readonly UserKeybinding[]
  /** The app's and terminals' keys with those entries applied. */
  shell: ShellKeymap
  /** Loads keybindings.json and follows every save of it; returns the unsubscribe. */
  connect: () => () => void
  /** Opens keybindings.json in an editor tab, creating it with every default commented out. */
  openFile: () => Promise<void>
}

const failed = (error: unknown): void => {
  notify({ severity: 'error', title: 'Keybindings', body: mainErrorMessage(error) })
}

function showInEditor(path: string): void {
  useShellLayoutStore.getState().showFiles()
  useEditorTabStore.getState().open(path)
}

export const useKeymapStore = create<KeymapState>((set, get) => {
  // Problems in keybindings.json: the app keeps the keys it could use, so they are warnings.
  const showNotice = followNotice((body) => ({
    severity: 'warning',
    title: 'Keybindings',
    body,
    action: { label: 'Open keybindings.json', run: () => void get().openFile() }
  }))
  const apply = ({ entries, notice }: KeybindingsView): void => {
    set({ entries, shell: shellKeymap(rendererPlatform, entries) })
    showNotice(notice)
  }
  return {
    entries: [],
    shell: shellKeymap(rendererPlatform),
    connect: () => {
      const unsubscribe = window.desktop.subscribeKeybindings(apply)
      const unsubscribeShow = window.desktop.subscribeShowKeybindingsFile(showInEditor)
      window.desktop.getKeybindings().then(apply, failed)
      return () => {
        unsubscribe()
        unsubscribeShow()
      }
    },
    openFile: () => window.desktop.openKeybindingsFile().then(showInEditor, failed)
  }
})
