import { create } from 'zustand'
import { mainErrorMessage } from '@/lib/main-error-message'
import { focusedEditorSelection } from './editor-selection'
import { useShellLayoutStore } from './shell-layout-store'
import type { SearchFileResult, SearchQuery } from '../../../shared/search-api'

/** Typing pauses this long before a search starts, so each letter doesn't start one. */
const TYPING_PAUSE_MS = 200

/** `interrupted`: stopped by the panel closing; it runs again when the panel opens. */
type SearchStatus = 'idle' | 'searching' | 'done' | 'interrupted'

type SearchState = {
  query: SearchQuery
  /** Counts searches; a new one starts with its first result active. */
  generation: number
  status: SearchStatus
  /** By path. */
  files: SearchFileResult[]
  /** More matches than the limit; only the first are shown. */
  limited: boolean
  error: string | null
  /** Changes when the search box should take the keys and select its text. */
  focusRequest: number
  /** Listens for results from main; returns the unsubscribe. */
  connect: () => () => void
  /** Changes the query and searches again. */
  setQuery: (change: Partial<SearchQuery>) => void
  /** Shows Find in Files with the search box focused: the editor's selection as the text, if any. */
  findInFiles: (scope?: string[]) => void
  /** Stops the running search, to run again on `resume`. */
  cancel: () => void
  /** Runs a search the panel closing interrupted. */
  resume: () => void
  /** The workspace's folders changed: results from the old ones are dropped and the search runs again. */
  workspaceChanged: () => void
}

const EMPTY_QUERY: SearchQuery = {
  text: '',
  regex: false,
  matchCase: false,
  wholeWord: false,
  fileMask: '',
  includeNonProject: false,
  scope: []
}

/** `files` with `added` put in by path, as they stream in from main in no particular order. */
function mergeFiles(files: SearchFileResult[], added: SearchFileResult[]): SearchFileResult[] {
  return [...files, ...added].toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

export const useSearchStore = create<SearchState>((set, get) => {
  let searchId = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  const run = (): void => {
    if (timer) clearTimeout(timer)
    timer = null
    const { query } = get()
    searchId += 1
    set({ generation: searchId })
    if (query.text === '') {
      void window.desktop.cancelSearch()
      set({ status: 'idle', files: [], limited: false, error: null })
      return
    }
    const id = searchId
    set({ status: 'searching', files: [], limited: false, error: null })
    window.desktop.startSearch(id, query).catch((error: unknown) => {
      if (id === searchId) set({ status: 'done', error: mainErrorMessage(error) })
    })
  }

  return {
    query: EMPTY_QUERY,
    generation: 0,
    status: 'idle',
    files: [],
    limited: false,
    error: null,
    focusRequest: 0,
    connect: () =>
      window.desktop.subscribeSearch((event) => {
        if (event.id !== searchId) return
        if (event.kind === 'results') {
          set((state) => ({ files: mergeFiles(state.files, event.files) }))
        } else {
          set({ status: 'done', limited: event.limited, error: event.error })
        }
      }),
    setQuery: (change) => {
      set((state) => ({ query: { ...state.query, ...change } }))
      if (timer) clearTimeout(timer)
      // Typed text waits for a pause; a toggled option searches at once.
      if ('text' in change && get().query.text !== '') timer = setTimeout(run, TYPING_PAUSE_MS)
      else run()
    },
    findInFiles: (scope = []) => {
      const selected = focusedEditorSelection()
      useShellLayoutStore.getState().showPanel('search')
      const { query } = get()
      const changed =
        (selected !== null && selected !== query.text) || scope.length > 0 || query.scope.length > 0
      set((state) => ({
        focusRequest: state.focusRequest + 1,
        query: { ...state.query, ...(selected === null ? {} : { text: selected }), scope }
      }))
      if (changed) run()
    },
    cancel: () => {
      if (timer) clearTimeout(timer)
      timer = null
      searchId += 1
      void window.desktop.cancelSearch()
      if (get().status === 'searching') set({ status: 'interrupted' })
    },
    resume: () => {
      if (get().status === 'interrupted') run()
    },
    workspaceChanged: () => {
      // A folder searched in may have left the workspace.
      set((state) => ({ query: { ...state.query, scope: [] } }))
      run()
    }
  }
})
