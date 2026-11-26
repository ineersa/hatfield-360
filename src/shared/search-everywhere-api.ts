import type { MatchRanges } from './fuzzy-path-match'

/** What Search Everywhere lists: everything, or one kind as Go to File / Class / Symbol do. */
export type SearchEverywhereKind = 'all' | 'files' | 'classes' | 'symbols'

/** A workspace file a query matched. */
export type FileHit = {
  path: string
  /** The path inside its workspace folder, which the query was matched against. */
  relative: string
  /** The workspace folder's name, shown when the workspace has more than one. */
  folder: string
  score: number
  /** The matched characters of `relative`. */
  ranges: MatchRanges
}

/** The most files one query returns. */
export const FILE_HIT_LIMIT = 50
/** Longer than any search box holds. */
export const SEARCH_EVERYWHERE_QUERY_LIMIT = 1000

export const SEARCH_EVERYWHERE_CHANNELS = {
  findFiles: 'search-everywhere:find-files'
} as const

export type SearchEverywhereApi = {
  /**
   * The workspace files whose path matches `query`, best first, leaving out what git ignores and
   * dependency folders. A query overtaken by a newer one resolves empty.
   */
  findWorkspaceFiles: (query: string) => Promise<FileHit[]>
}
