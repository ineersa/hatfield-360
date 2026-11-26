import { isAbsolute } from 'node:path'
import {
  SEARCH_EVERYWHERE_CHANNELS,
  SEARCH_EVERYWHERE_QUERY_LIMIT,
  UNLISTED_PATHS_LIMIT
} from '../../shared/search-everywhere-api'
import { fileIndex } from '../search/file-index'
import { workspaceStore } from '../workspace/workspace-store'
import { handleTrusted } from './trusted-ipc'

const workspaceFolders = async (): Promise<string[]> =>
  (await workspaceStore.view()).folders.filter((folder) => !folder.missing).map((f) => f.path)

/** Set by the first search, which starts the index; cleared if starting it failed, to try again. */
let following: Promise<void> | null = null

function startIndex(): Promise<void> {
  following ??= fileIndex.update(workspaceFolders).catch((error: unknown) => {
    following = null
    throw error
  })
  return following
}

export function registerSearchEverywhereIpc(): void {
  workspaceStore.onChange(() => {
    if (following === null) return
    fileIndex.update(workspaceFolders).catch((error: unknown) => {
      console.error('Following the workspace for Search Everywhere failed:', error)
    })
  })
  handleTrusted(SEARCH_EVERYWHERE_CHANNELS.findFiles, async (_event, query) => {
    if (typeof query !== 'string' || query.length > SEARCH_EVERYWHERE_QUERY_LIMIT)
      throw new Error('Expected a query')
    await startIndex()
    return fileIndex.find(query)
  })
  handleTrusted(SEARCH_EVERYWHERE_CHANNELS.findUnlisted, async (_event, paths) => {
    if (
      !Array.isArray(paths) ||
      paths.length > UNLISTED_PATHS_LIMIT ||
      !paths.every((path) => typeof path === 'string' && isAbsolute(path))
    )
      throw new Error('Expected absolute paths')
    await startIndex()
    return fileIndex.unlisted(paths)
  })
}
