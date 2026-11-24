import { create } from 'zustand'
import { separatorOf } from '@/components/editor/editor-tab-labels'
import { locateInTree } from '@/components/files/file-tree-rows'
import { mainErrorMessage } from '@/lib/main-error-message'
import { useEditorTabStore } from '@/state/editor-tab-store'
import { notify } from '@/state/notification-store'
import type { DirectoryEntry, DirectoryListing, PathForm } from '../../../shared/file-tree-api'
import type { WorkspaceFolderKind } from '../../../shared/workspace-api'

/** A top-level folder of the tree, with the linked worktrees shown under it (projects only). */
export type FileTreeRoot = { path: string; kind: WorkspaceFolderKind; worktrees: string[] }

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
  /** Puts back a workspace's saved tree: its expanded folders and whether ignored files are hidden. */
  restore: (expanded: string[], hideIgnored: boolean) => void
  copyPath: (path: string, form: PathForm) => void
  reveal: (path: string) => void
  /** The file Select Opened File is revealing, until the tree shows its row (by `key`). */
  locating: { path: string; key: string } | null
  /** Expands the tree down to the active editor tab's file, which the Files panel then selects. */
  selectOpenedFile: () => void
  locateDone: () => void
  /** Follows changes main reports in watched folders; returns the unsubscribe. */
  connect: () => () => void
}

/**
 * Expanded folders the tree shows, from `from` down through expanded subfolders and, for a root,
 * its expanded worktrees. As in the tree, worktrees hang only under a root: a project and its own
 * linked worktree can both be roots, each listing the other as a worktree.
 */
function openFolders(state: FileTreeState, from: string[]): string[] {
  const worktrees = new Map(state.roots.map((root) => [root.path, root.worktrees]))
  const open = new Set<string>()
  const visit = (path: string, linked: string[]): void => {
    if (!state.expanded[path] || open.has(path)) return
    open.add(path)
    for (const worktree of linked) visit(worktree, [])
    const listing = state.listings[path]
    if (listing?.status !== 'ok') return
    for (const entry of listing.entries) if (entry.kind === 'directory') visit(entry.path, [])
  }
  for (const path of from) visit(path, worktrees.get(path) ?? [])
  return [...open]
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

  /** Hide Ignored Files stops hiding when it hides the file being located or a folder above it. */
  const showLocated = (): void => {
    const { locating, hideIgnored, listings } = get()
    if (!locating || !hideIgnored) return
    const above = (entry: DirectoryEntry): boolean =>
      locating.path === entry.path || locating.path.startsWith(entry.path + separatorOf(entry.path))
    const hidden = Object.values(listings).some(
      (listing) => listing.status === 'ok' && listing.entries.some((e) => e.ignored && above(e))
    )
    if (hidden) set({ hideIgnored: false })
  }

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
        showLocated()
        // A restored tree has expanded subfolders that were never listed; they open as they are reached.
        if (listing.status === 'ok') {
          for (const entry of listing.entries) {
            const unlisted = !get().listings[entry.path] && !requests.has(entry.path)
            if (entry.kind === 'directory' && get().expanded[entry.path] && unlisted)
              load(entry.path)
          }
        }
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
      const before = new Map(get().roots.map((root) => [root.path, root]))
      // Nothing was watched under a root while it wasn't shown, and a root that changed kind gains or
      // loses its ignore status, so their open folders are listed fresh.
      const added = roots.flatMap((root) => {
        const shown = before.get(root.path)
        if (shown?.kind !== root.kind) return [root.path, ...root.worktrees]
        return root.worktrees.filter((worktree) => !shown.worktrees.includes(worktree))
      })
      set({ roots })
      const stale = openFolders(get(), added)
      for (const path of stale) load(path)
      if (stale.length === 0) syncWatches()
    },
    toggle: (path) => {
      const expand = !get().expanded[path]
      set((state) => ({ expanded: { ...state.expanded, [path]: expand } }))
      // Expanding lists the folder and the open folders kept under it fresh: none was watched while
      // it was collapsed.
      if (expand) for (const folder of openFolders(get(), [path])) load(folder)
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
      for (const folder of openFolders(get(), collapsed)) load(folder)
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
    restore: (expanded, hideIgnored) => {
      set({ expanded: Object.fromEntries(expanded.map((path) => [path, true])), hideIgnored })
      const roots = get().roots.map((root) => root.path)
      for (const folder of openFolders(get(), roots)) load(folder)
      syncWatches()
    },
    copyPath: (path, form) => {
      window.desktop.copyPath(path, form).catch(failed)
    },
    reveal: (path) => {
      window.desktop.revealPath(path).catch(failed)
    },
    locating: null,
    selectOpenedFile: () => {
      const path = useEditorTabStore.getState().activePath
      const located = path === null ? null : locateInTree(get().roots, path)
      if (path === null || located === null) return
      set({ locating: { path, key: located.key } })
      get().expand(located.folders)
      showLocated()
    },
    locateDone: () => set({ locating: null }),
    connect: () =>
      window.desktop.subscribeDirectoryChanges((paths) => {
        const open = new Set(shownOpenFolders())
        for (const path of paths) if (open.has(path)) load(path)
      })
  }
})
