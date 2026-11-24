/** What Find in Files looks for, and where. */
export type SearchQuery = {
  text: string
  regex: boolean
  matchCase: boolean
  wholeWord: boolean
  /** Comma-separated file name globs; one starting with `!` leaves files out (`*.ts, !*.test.ts`). */
  fileMask: string
  /** Searches ignored files and dependency folders (`node_modules`, `vendor`, ...) too. */
  includeNonProject: boolean
  /** Folders inside the workspace to search in; empty for every workspace folder and worktree. */
  scope: string[]
}

/** One match: its line and where on it, in UTF-16 code units from 0 as editors count. */
export type SearchMatch = {
  /** From 1. */
  line: number
  start: number
  end: number
  /** The line's text, cut short around the match when the line is very long. */
  text: string
  /** Where `text` begins on the line, when it was cut short. */
  textStart: number
}

export type SearchFileResult = { path: string; matches: SearchMatch[] }

export type SearchEvent =
  | { id: number; kind: 'results'; files: SearchFileResult[] }
  | {
      id: number
      kind: 'done'
      /** Stopped at the match limit, so there are more than shown. */
      limited: boolean
      /** Why the search failed (a bad regex), or files it couldn't read. */
      error: string | null
    }

/** The most matches one search returns. */
export const SEARCH_MATCH_LIMIT = 2000

export const SEARCH_CHANNELS = {
  start: 'search:start',
  cancel: 'search:cancel',
  event: 'search:event'
} as const

export type SearchApi = {
  /**
   * Starts a search, stopping this window's previous one. Results and then a `done` event arrive
   * through `subscribeSearch`, tagged with `id`.
   */
  startSearch: (id: number, query: SearchQuery) => Promise<void>
  /** Stops this window's running search, if any. */
  cancelSearch: () => Promise<void>
  subscribeSearch: (callback: (event: SearchEvent) => void) => () => void
}
