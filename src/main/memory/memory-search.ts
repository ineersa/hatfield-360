import { realpath } from 'node:fs/promises'
import type { MemoryRecallResult, MemorySearchResult } from '../../shared/memory-search-api'
import { settingsStore } from '../settings/settings-store'
import { workspaceStore } from '../workspace/workspace-store'
import { callLibrarianTool, type LibrarianEndpoint } from './librarian-client'
import { librarianDate, parseMemoryRecall, parseMemorySearch } from './librarian-results'

const SEARCH_LIMIT = 50

async function librarianEndpoint(): Promise<LibrarianEndpoint | null> {
  const { values } = await settingsStore.view()
  const url = values['memory.librarianUrl']
  if (!url) return null
  const variable = values['memory.librarianTokenVariable']
  const token = variable ? process.env[variable] : undefined
  if (variable && !token)
    throw new Error(`The ${variable} environment variable for Librarian's token isn't set.`)
  return { url, timeoutMs: values['memory.librarianTimeoutSeconds'] * 1000, token: token ?? null }
}

/** Librarian indexes a project by its real checkout root; only workspace projects may be searched. */
async function projectRoot(project: string): Promise<string> {
  const { folders } = await workspaceStore.view()
  if (!folders.some((folder) => folder.path === project && folder.kind === 'project'))
    throw new Error('Choose a project in the current workspace.')
  try {
    return await realpath(project)
  } catch {
    throw new Error('The project folder is unavailable.')
  }
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export async function searchMemory(
  project: string,
  query: string,
  after: number | null,
  signal: AbortSignal
): Promise<MemorySearchResult> {
  try {
    const endpoint = await librarianEndpoint()
    if (!endpoint) return { status: 'unconfigured' }
    const payload = await callLibrarianTool(
      endpoint,
      await projectRoot(project),
      'memory_search',
      { query, limit: SEARCH_LIMIT, ...(after === null ? {} : { after: librarianDate(after) }) },
      signal
    )
    return { status: 'ok', ...parseMemorySearch(payload) }
  } catch (error) {
    if (signal.aborted) return { status: 'superseded' }
    return { status: 'error', message: errorMessage(error) }
  }
}

export async function recallMemory(project: string, id: string): Promise<MemoryRecallResult> {
  try {
    const endpoint = await librarianEndpoint()
    if (!endpoint) return { status: 'unconfigured' }
    const payload = await callLibrarianTool(
      endpoint,
      await projectRoot(project),
      'recall',
      { id },
      new AbortController().signal
    )
    return { status: 'ok', evidence: parseMemoryRecall(payload) }
  } catch (error) {
    return { status: 'error', message: errorMessage(error) }
  }
}
