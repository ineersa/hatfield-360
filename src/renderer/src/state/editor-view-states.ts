import type { editor } from 'monaco-editor'
import { isPlainObject } from '../../../shared/plain-object'
import { useEditorTabStore } from './editor-tab-store'

/**
 * Each open tab's cursor, scroll position and folds, as the editor saved them: kept while another tab
 * is shown and across restarts. Here rather than with the editor, so saving them needs no Monaco.
 */
const viewStates = new Map<string, editor.ICodeEditorViewState>()
const listeners = new Set<() => void>()

/** Whether stored data has the shape of a view state the editor saved. */
export function isEditorViewState(value: unknown): value is editor.ICodeEditorViewState {
  return isPlainObject(value) && Array.isArray(value.cursorState) && isPlainObject(value.viewState)
}

export const editorViewState = (path: string): editor.ICodeEditorViewState | undefined =>
  viewStates.get(path)

export function setEditorViewState(path: string, state: editor.ICodeEditorViewState): void {
  viewStates.set(path, state)
  for (const listener of listeners) listener()
}

export function subscribeEditorViewStates(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// A view state lives as long as its tab.
useEditorTabStore.subscribe((state) => {
  for (const path of viewStates.keys()) {
    if (!state.tabs.some((tab) => tab.path === path)) viewStates.delete(path)
  }
})
