import type { AgentProvider } from './agent-api'

export type MemoryImportance = 'low' | 'medium' | 'high' | 'critical'

/** One retained memory from Librarian's `memory_search`, most relevant first. */
export type MemoryHit = {
  /** Full lowercase hex id, accepted by `recall`. */
  id: string
  kind: 'observation' | 'reflection'
  /** The provider conversation the memory came from, as Librarian recorded it. */
  sessionId: string
  /** Read from the session ID's shape (Claude UUIDs, Hatfield numbers); null when it fits neither. */
  provider: AgentProvider | null
  /** Epoch milliseconds, to the minute. */
  at: number
  content: string
  /** Assigned by the source, not a relevance score; null when Librarian gave none. */
  importance: MemoryImportance | null
}

/** One source event behind a memory, condensed to readable text. */
export type MemoryEvidence = {
  /** Epoch milliseconds, or null when the event carried no time. */
  at: number | null
  speaker: 'user' | 'assistant' | 'tool'
  text: string
}

type MemorySearchRequest = {
  project: string
  query: string
  /** Epoch milliseconds: only memories from then on. Null searches all retained history. */
  after: number | null
}

type Unavailable =
  /** No Librarian URL in Settings. */
  | { status: 'unconfigured' }
  /** A newer search from this window replaced this one. */
  | { status: 'superseded' }
  | { status: 'error'; message: string }

export type MemorySearchResult =
  | {
      status: 'ok'
      hits: MemoryHit[]
      /** Librarian's index is behind: newer or changed memories may be missing. */
      partial: boolean
    }
  | Unavailable

export type MemoryRecallResult = { status: 'ok'; evidence: MemoryEvidence[] } | Unavailable

export const MEMORY_SEARCH_CHANNELS = {
  search: 'memory:search',
  recall: 'memory:recall'
} as const

export type MemorySearchApi = {
  searchMemory: (request: MemorySearchRequest) => Promise<MemorySearchResult>
  /** The source evidence behind one memory, through Librarian's `recall`. */
  recallMemory: (project: string, id: string) => Promise<MemoryRecallResult>
}
