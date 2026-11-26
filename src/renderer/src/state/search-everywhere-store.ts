import { CancellationTokenSource } from 'vscode-languageclient/browser'
import { create } from 'zustand'
import { findWorkspaceSymbols } from '@/components/editor/language-clients'
import { mainErrorMessage } from '@/lib/main-error-message'
import { useEditorTabStore } from './editor-tab-store'
import { useShellLayoutStore } from './shell-layout-store'
import type { FileHit, SearchEverywhereKind } from '../../../shared/search-everywhere-api'
import { rankSymbols, type SymbolHit } from '../../../shared/workspace-symbol-hits'

type SearchEverywhereState = {
  open: boolean
  kind: SearchEverywhereKind
  query: string
  files: FileHit[]
  symbols: SymbolHit[]
  /** Whether results for `query` are still coming. */
  searching: boolean
  error: string | null
  /** Opens the popup on `kind`, with what was typed last selected. */
  show: (kind: SearchEverywhereKind) => void
  close: () => void
  setKind: (kind: SearchEverywhereKind) => void
  setQuery: (query: string) => void
  /** Gives the keys back to what had them when the popup opened. */
  returnFocus: () => void
  /** Closes the popup and opens the file, at the symbol's line when it is one. */
  choose: (hit: { path: string; line: number | null; column: number | null }) => void
}

const wantsFiles = (kind: SearchEverywhereKind): boolean => kind === 'all' || kind === 'files'

export const useSearchEverywhereStore = create<SearchEverywhereState>((set, get) => {
  let generation = 0
  let symbolRequests: CancellationTokenSource | null = null
  let focusedBefore: HTMLElement | null = null

  /** Looks `query` up again: files in main, symbols in the running language servers. */
  const run = (): void => {
    const id = ++generation
    symbolRequests?.cancel()
    symbolRequests = null
    const { query, kind, open } = get()
    if (!open || query.trim() === '') {
      set({ files: [], symbols: [], searching: false, error: null })
      return
    }
    const current = (): boolean => id === generation
    const files = wantsFiles(kind)
      ? window.desktop.findWorkspaceFiles(query).then((hits) => {
          if (current()) set({ files: hits })
        })
      : Promise.resolve(set({ files: [] }))
    let symbols: Promise<void> = Promise.resolve(set({ symbols: [] }))
    if (kind !== 'files') {
      const requests = new CancellationTokenSource()
      symbolRequests = requests
      symbols = findWorkspaceSymbols(query, requests.token).then((lists) => {
        if (current()) set({ symbols: rankSymbols(query, lists, kind === 'classes') })
      })
    }
    set({ searching: true, error: null })
    Promise.all([files, symbols])
      .catch((error: unknown) => {
        if (current()) set({ error: mainErrorMessage(error) })
      })
      .finally(() => {
        if (current()) set({ searching: false })
      })
  }

  return {
    open: false,
    kind: 'all',
    query: '',
    files: [],
    symbols: [],
    searching: false,
    error: null,
    show: (kind) => {
      if (!get().open)
        focusedBefore =
          document.activeElement instanceof HTMLElement ? document.activeElement : null
      set({ open: true, kind })
      run()
    },
    close: () => {
      set({ open: false })
      run()
    },
    setKind: (kind) => {
      set({ kind })
      run()
    },
    setQuery: (query) => {
      set({ query })
      run()
    },
    returnFocus: () => {
      if (focusedBefore?.isConnected) focusedBefore.focus()
      focusedBefore = null
    },
    choose: ({ path, line, column }) => {
      set({ open: false })
      run()
      useShellLayoutStore.getState().showFiles()
      const start = column === null ? 0 : column - 1
      useEditorTabStore.getState().open(path, { line: line ?? 1, start, end: start, focus: true })
    }
  }
})
