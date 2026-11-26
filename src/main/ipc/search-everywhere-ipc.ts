import {
  SEARCH_EVERYWHERE_CHANNELS,
  SEARCH_EVERYWHERE_QUERY_LIMIT
} from '../../shared/search-everywhere-api'
import type { WorkspaceFolder } from '../../shared/workspace-api'
import { fileIndex } from '../search/file-index'
import { workspaceStore } from '../workspace/workspace-store'
import { handleTrusted } from './trusted-ipc'

const present = (folders: readonly WorkspaceFolder[]): string[] =>
  folders.filter((folder) => !folder.missing).map((folder) => folder.path)

let following: Promise<void> | null = null

/** Indexes the workspace's folders on first use, then follows them as they change. */
function followWorkspace(): Promise<void> {
  following ??= (async () => {
    workspaceStore.onChange((view) => {
      fileIndex.setFolders(present(view.folders)).catch((error: unknown) => {
        console.error('Following the workspace for Search Everywhere failed:', error)
      })
    })
    await fileIndex.setFolders(present((await workspaceStore.view()).folders))
  })()
  return following
}

export function registerSearchEverywhereIpc(): void {
  handleTrusted(SEARCH_EVERYWHERE_CHANNELS.findFiles, async (_event, query) => {
    if (typeof query !== 'string' || query.length > SEARCH_EVERYWHERE_QUERY_LIMIT)
      throw new Error('Expected a query')
    await followWorkspace()
    return fileIndex.find(query)
  })
}
