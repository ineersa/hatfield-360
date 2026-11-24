/** Reads the editor's selection; set by the editor while it exists, which loads with the first file. */
let source: (() => string | null) | null = null

export function setEditorSelectionSource(next: (() => string | null) | null): void {
  source = next
}

/** The text selected in the editor while it has the keys, when it is on one line; else null. */
export const focusedEditorSelection = (): string | null => source?.() ?? null
