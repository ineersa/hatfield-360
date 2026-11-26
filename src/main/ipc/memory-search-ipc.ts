import { MEMORY_SEARCH_CHANNELS } from '../../shared/memory-search-api'
import { isPlainObject } from '../../shared/plain-object'
import { recallMemory, searchMemory } from '../memory/memory-search'
import { handleTrusted } from './trusted-ipc'

const MAX_QUERY = 2000

export function registerMemorySearchIpc(): void {
  // One search per window: a newer one cancels the request it replaces.
  const searches = new Map<number, AbortController>()
  handleTrusted(MEMORY_SEARCH_CHANNELS.search, async (event, value) => {
    if (
      !isPlainObject(value) ||
      typeof value.project !== 'string' ||
      typeof value.query !== 'string' ||
      !(value.after === null || (typeof value.after === 'number' && Number.isFinite(value.after)))
    )
      throw new Error('Invalid memory search.')
    const query = value.query.trim()
    if (!query || query.length > MAX_QUERY) throw new Error('Invalid memory search query.')
    const owner = event.sender.id
    searches.get(owner)?.abort()
    const controller = new AbortController()
    searches.set(owner, controller)
    try {
      return await searchMemory(value.project, query, value.after, controller.signal)
    } finally {
      if (searches.get(owner) === controller) searches.delete(owner)
    }
  })
  handleTrusted(MEMORY_SEARCH_CHANNELS.recall, (_event, project, id) => {
    if (typeof project !== 'string' || typeof id !== 'string' || !/^[a-f\d]{12,64}$/.test(id))
      throw new Error('Invalid memory recall.')
    return recallMemory(project, id)
  })
}
