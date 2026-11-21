import { create } from 'zustand'
import { mainErrorMessage } from '@/lib/main-error-message'
import { notify } from '@/state/notification-store'
import type { DirectoryListing, PathForm } from '../../../shared/file-tree-api'

/** A top-level folder of the tree, with the linked worktrees shown under it (projects only). */
export type FileTreeRoot = { path: string; worktrees: string[] }

type FileTreeState = {
  /** The shown tree's roots, in order; empty while the Files panel is closed, so nothing is watched. */
  roots: FileTreeRoot[]
  /** Expanded folders, kept while their parent is collapsed so they reopen as they were. */
  expanded: Record<string, boolean>
  listings: Record<string, DirectoryListing>
  hideIgnored: boolean
  setRoots: (roots: FileTreeRoot[]) => void
  toggle: (path: string) => void
  /** Expands the folders that are collapsed, as `*` does for a row and its siblings. */
  expand: (paths: string[]) => void
  collapseAll: () => void
  /** Lists the folder and its open subfolders again, for changes the watcher missed. */
  reload: (path: string) => void
  toggleHideIgnored: () => void
  copyPath: (path: string, form: PathForm) => void
  reveal: (path: string) => void
  /** Follows changes main reports in watched folders; returns the unsubscribe. */
  connect: () => () => void
}

/** Every folder the roots stand for: each root and its worktrees. */
const rootPaths = (roots: FileTreeRoot[]): string[] =>
  roots.flatMap((root) => [root.path, ...root.worktrees])

/** Expanded folders the tree shows, from `from` down through expanded worktrees and subfolders. */
function openFolders(state: FileTreeState, from: string[]): string[] {
  const worktrees = new Map(state.roots.map((root) => [root.path, root.worktrees]))
  const open: string[] = []
  const visit = (path: string): void => {
    if (!state.expanded[path]) return
    open.push(path)
    for (const worktree of worktrees.get(path) ?? []) visit(worktree)
    const listing = state.listings[path]
    if (listing?.status !== 'ok') return
    for (const entry of listing.entries) if (entry.kind === 'directory') visit(entry.path)
  }
  for (const path of from) visit(path)
  return [...new Set(open)]
}

const failed = (error: unknown): void => {
  notify({ severity: 'error', title: 'Files', body: mainErrorMessage(error) })
}

export const useFileTreeStore = create<FileTreeState>((set, get) => {
  let watched = ''
  /** Latest request per folder, so a slow older listing can't overwrite a newer one. */
  const requests = new Map<string, number>()
  let requestCount = 0

  const shownOpenFolders = (): string[] =>
    openFolders(
      get(),
      get().roots.map((root) => root.path)
    )

  /** Main watches exactly the folders the tree shows open. */
  const syncWatches = (): void => {
    const open = shownOpenFolders()
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
      const shown = new Set(rootPaths(get().roots))
      const added = rootPaths(roots).filter((path) => !shown.has(path))
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
    expand: (paths) => {
      const collapsed = paths.filter((path) => !get().expanded[path])
      if (collapsed.length === 0) return
      set((state) => ({
        expanded: {
          ...state.expanded,
          ...Object.fromEntries(collapsed.map((path) => [path, true]))
        }
      }))
      for (const path of collapsed) load(path)
    },
    collapseAll: () => {
      set({ expanded: {} })
      syncWatches()
    },
    reload: (path) => {
      const open = openFolders(get(), [path])
      for (const folder of open.length > 0 ? open : [path]) load(folder)
    },
    toggleHideIgnored: () => set((state) => ({ hideIgnored: !state.hideIgnored })),
    copyPath: (path, form) => {
      window.desktop.copyPath(path, form).catch(failed)
    },
    reveal: (path) => {
      window.desktop.revealPath(path).catch(failed)
    },
    connect: () =>
      window.desktop.subscribeDirectoryChanges((paths) => {
        const open = new Set(shownOpenFolders())
        for (const path of paths) if (open.has(path)) load(path)
      })
  }
})
