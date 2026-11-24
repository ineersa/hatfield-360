import { create } from 'zustand'

/** Reads the editor's selection; set by the editor while it exists, which loads with the first file. */
let source: (() => string | null) | null = null

export function setEditorSelectionSource(next: (() => string | null) | null): void {
  source = next
}

/** The text selected in the editor while it has the keys, when it is on one line; else null. */
export const focusedEditorSelection = (): string | null => source?.() ?? null

/** Where the editor's caret is, from 1, how much is selected, and how the file is laid out. */
export type EditorCaret = {
  line: number
  column: number
  chars: number
  lineBreaks: number
  lineSeparator: 'LF' | 'CRLF'
  /** `2 spaces` or `Tab`. */
  indent: string
}

/** The shown editor's caret, for the status bar; null while no editor is on screen. */
export const useEditorCaretStore = create<{ caret: EditorCaret | null }>(() => ({ caret: null }))

export const setEditorCaret = (caret: EditorCaret | null): void =>
  useEditorCaretStore.setState({ caret })
