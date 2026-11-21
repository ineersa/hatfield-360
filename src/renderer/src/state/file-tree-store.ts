import { create } from 'zustand'
import { mainErrorMessage } from '@/lib/main-error-message'
import type { DirectoryListing } from '../../../shared/file-tree-api'

type FileTreeState = {
  /** The shown tree's root folders, in order; empty while the Files panel is closed, so nothing is watched. */
  roots: string[]
  /** Expanded folders, kept while their parent is collapsed so they reopen as they were. */
  expanded: Record<string, boolean>
  listings: Record<string, DirectoryListing>
  hideIgnored: boolean
  setRoots: (roots: string[]) => void
  toggle: (path: string) => void
  /** Lists the folder and its open subfolders again, for changes the watcher missed. */
  reload: (path: string) => void
  toggleHideIgnored: () => void
  /** Follows changes main reports in watched folders; returns the unsubscribe. */
  connect: () => () => void
}

/** Expanded folders the tree shows, from `from` down through expanded subfolders. */
function openFolders(state: FileTreeState, from: string[]): string[] {
  const open: string[] = []
  const visit = (path: string): void => {
    if (!state.expanded[path]) return
    open.push(path)
    const listing = state.listings[path]
    if (listing?.status !== 'ok') return
    for (const entry of listing.entries) if (entry.kind === 'directory') visit(entry.path)
  }
  for (const path of from) visit(path)
  return open
}

export const useFileTreeStore = create<FileTreeState>((set, get) => {
  let watched = ''
  /** Latest request per folder, so a slow older listing can't overwrite a newer one. */
  const requests = new Map<string, number>()
  let requestCount = 0

  /** Main watches exactly the folders the tree shows open. */
  const syncWatches = (): void => {
    const open = openFolders(get(), get().roots)
    const key = open.join('\0')
    if (key === watched) return
    watched = key
    window.desktop
      .watchDirectories(open)
      .catch((error: unknown) => console.error('Watching folders failed:', error))
  }

  const load = (path: string): void => {
    const request = ++requestCount
    requests.set(path, request)
    void window.desktop
      .listDirectory(path)
      .catch((error: unknown): DirectoryListing => ({
        path,
        status: 'error',
        message: mainErrorMessage(error)
      }))
      .then((listing) => {
        if (requests.get(path) !== request) return
        requests.delete(path)
        set((state) => ({ listings: { ...state.listings, [path]: listing } }))
        // A folder deleted while watched loses its watch; listing it again (once back) renews it.
        watched = ''
        syncWatches()
      })
  }

  return {
    roots: [],
    expanded: {},
    listings: {},
    hideIgnored: false,
    setRoots: (roots) => {
      const added = roots.filter((root) => !get().roots.includes(root))
      set({ roots })
      // Nothing was watched under a root while it wasn't shown, so its open folders are listed fresh.
      const stale = openFolders(get(), added)
      for (const path of stale) load(path)
      if (stale.length === 0) syncWatches()
    },
    toggle: (path) => {
      const expand = !get().expanded[path]
      set((state) => ({ expanded: { ...state.expanded, [path]: expand } }))
      // Expanding always lists the folder fresh: it wasn't watched while collapsed.
      if (expand) load(path)
      else syncWatches()
    },
    reload: (path) => {
      const open = openFolders(get(), [path])
      for (const folder of open.length > 0 ? open : [path]) load(folder)
    },
    toggleHideIgnored: () => set((state) => ({ hideIgnored: !state.hideIgnored })),
    connect: () =>
      window.desktop.subscribeDirectoryChanges((paths) => {
        const open = new Set(openFolders(get(), get().roots))
        for (const path of paths) if (open.has(path)) load(path)
      })
  }
})
