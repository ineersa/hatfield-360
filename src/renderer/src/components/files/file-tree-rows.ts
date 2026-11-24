import type { DirectoryEntry, DirectoryListing } from '../../../../shared/file-tree-api'
import type { WorkspaceFolder } from '../../../../shared/workspace-api'
import type { ProjectWorktrees, Worktree } from '../../../../shared/worktree-api'
import { separatorOf } from '../editor/editor-tab-labels'

export type TreeWorktree = { path: string; name: string; branch: string }

/** A top-level folder of the tree: a workspace folder, with a project's linked worktrees under it. */
export type TreeRoot = {
  path: string
  name: string
  /** The checked-out branch, for projects. */
  branch: string | null
  folder: WorkspaceFolder
  worktrees: TreeWorktree[]
}

/** Where a row sits: its parent row's key, and its place among its siblings. */
type Placement = { depth: number; parent: string | null; setSize: number; position: number }

export type Row = Placement &
  (
    | { type: 'root'; key: string; root: TreeRoot }
    | { type: 'worktree'; key: string; worktree: TreeWorktree }
    | { type: 'entry'; key: string; entry: DirectoryEntry; ignored: boolean; folder: string }
    | { type: 'loading' | 'empty'; key: string; onlyIgnored: boolean }
    | { type: 'error'; key: string; folder: string; message: string }
  )

const worktreeKey = (parent: string, path: string): string => `${parent}\0\0worktree\0${path}`
const entryKey = (parent: string, name: string): string => `${parent}\0${name}`

const branchOf = (worktree: Worktree): string =>
  worktree.branch ?? `detached ${worktree.head.slice(0, 7)}`

export function treeRoots(
  folders: WorkspaceFolder[],
  projects: Record<string, ProjectWorktrees>
): TreeRoot[] {
  return folders.map((folder) => {
    const project = folder.kind === 'project' ? projects[folder.path] : undefined
    const worktrees = project?.status === 'git' && !folder.missing ? project.worktrees : []
    const checkout = worktrees.find((worktree) => worktree.project)
    return {
      path: folder.path,
      name: folder.name,
      branch: checkout ? branchOf(checkout) : null,
      folder,
      worktrees: worktrees
        .filter((worktree) => !worktree.project && !worktree.prunable)
        .map((worktree) => ({
          path: worktree.path,
          name: worktree.name,
          branch: branchOf(worktree)
        }))
    }
  })
}

/**
 * The tree as rows: each root, then its worktrees and the entries of every expanded folder under
 * it. Keys follow the row's place, not just its path, since a worktree can sit inside its project.
 */
export function treeRows(
  roots: TreeRoot[],
  expanded: Record<string, boolean>,
  listings: Record<string, DirectoryListing>,
  hideIgnored: boolean
): { rows: Row[]; hiddenIgnored: number } {
  const rows: Row[] = []
  let hiddenIgnored = 0
  const addChildren = (
    folder: string,
    parent: string,
    depth: number,
    parentIgnored: boolean,
    worktrees: TreeWorktree[]
  ): void => {
    if (!expanded[folder]) return
    const listing = listings[folder]
    const all = listing?.status === 'ok' ? listing.entries : []
    const entries = all.filter((entry) => !(hideIgnored && (parentIgnored || entry.ignored)))
    hiddenIgnored += all.length - entries.length
    const status =
      listing === undefined
        ? 'loading'
        : listing.status === 'error'
          ? 'error'
          : entries.length === 0 && worktrees.length === 0
            ? 'empty'
            : null
    const setSize = worktrees.length + (status === null ? entries.length : 1)
    let position = 0
    const place = (): Placement => ({ depth, parent, setSize, position: ++position })
    for (const worktree of worktrees) {
      const key = worktreeKey(parent, worktree.path)
      rows.push({ type: 'worktree', key, worktree, ...place() })
      addChildren(worktree.path, key, depth + 1, false, [])
    }
    if (listing?.status === 'error') {
      rows.push({
        type: 'error',
        key: `${parent}\0\0error`,
        folder,
        message: listing.message,
        ...place()
      })
    } else if (status === 'loading' || status === 'empty') {
      rows.push({
        type: status,
        key: `${parent}\0\0status`,
        onlyIgnored: all.length > 0,
        ...place()
      })
    }
    for (const entry of entries) {
      const ignored = parentIgnored || entry.ignored
      const key = entryKey(parent, entry.name)
      rows.push({ type: 'entry', key, entry, ignored, folder, ...place() })
      if (entry.kind === 'directory') addChildren(entry.path, key, depth + 1, ignored, [])
    }
  }
  roots.forEach((root, index) => {
    rows.push({
      type: 'root',
      key: root.path,
      root,
      depth: 0,
      parent: null,
      setSize: roots.length,
      position: index + 1
    })
    if (!root.folder.missing) addChildren(root.path, root.path, 1, false, root.worktrees)
  })
  return { rows, hiddenIgnored }
}

/** The folder a row opens, if it is one. */
export function folderOf(row: Row): string | null {
  if (row.type === 'root') return row.root.folder.missing ? null : row.root.path
  if (row.type === 'worktree') return row.worktree.path
  if (row.type === 'entry' && row.entry.kind === 'directory') return row.entry.path
  return null
}

/** What a row is called, for jumping to it by typing. */
export function nameOf(row: Row): string | null {
  if (row.type === 'root') return row.root.name
  if (row.type === 'worktree') return row.worktree.branch
  if (row.type === 'entry') return row.entry.name
  return null
}

/** The path Copy Path copies; a missing root has none on disk. */
export function pathOf(row: Row): string | null {
  if (row.type === 'root') return row.root.folder.missing ? null : row.root.path
  if (row.type === 'worktree') return row.worktree.path
  if (row.type === 'entry') return row.entry.path
  return null
}

/** The names from `folder` down to `path`, or null when `path` isn't below `folder`. */
function namesBelow(folder: string, path: string): string[] | null {
  const separator = separatorOf(folder)
  const prefix = folder.endsWith(separator) ? folder : folder + separator
  return path.startsWith(prefix) ? path.slice(prefix.length).split(separator).filter(Boolean) : null
}

/**
 * Where a file shows in the tree: the folders to expand down to it and the key its row will have.
 * Under the deepest folder that holds it, so a worktree inside its project's folder wins; null when
 * no folder of the tree holds it.
 */
export function locateInTree(
  roots: readonly { path: string; worktrees: readonly string[] }[],
  path: string
): { folders: string[]; key: string } | null {
  type Place = { folder: string; key: string; expand: string[]; names: string[] }
  const places = roots.flatMap((root): Place[] => {
    const inRoot = namesBelow(root.path, path)
    const own = inRoot
      ? [{ folder: root.path, key: root.path, expand: [root.path], names: inRoot }]
      : []
    return [
      ...own,
      ...root.worktrees.flatMap((worktree): Place[] => {
        const names = namesBelow(worktree, path)
        if (!names) return []
        const key = worktreeKey(root.path, worktree)
        return [{ folder: worktree, key, expand: [root.path, worktree], names }]
      })
    ]
  })
  const [place] = places.toSorted((a, b) => a.names.length - b.names.length)
  if (!place) return null
  const separator = separatorOf(place.folder)
  const folders = [...place.expand]
  let folder = place.folder
  let key = place.key
  for (const [index, name] of place.names.entries()) {
    key = entryKey(key, name)
    if (index === place.names.length - 1) break
    folder = folder.endsWith(separator) ? folder + name : folder + separator + name
    folders.push(folder)
  }
  return { folders, key }
}
