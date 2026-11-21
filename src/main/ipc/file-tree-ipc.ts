import { clipboard, shell, type WebContents } from 'electron'
import { FILE_TREE_CHANNELS } from '../../shared/file-tree-api'
import { listDirectory } from '../files/directory-listing'
import { DirectoryWatchers } from '../files/directory-watchers'
import { fileRoots } from '../files/file-roots'
import { resolveInsideRoots, rootRelativePath } from '../files/path-containment'
import { handleTrusted } from './trusted-ipc'

/** More expanded folders than any tree shows; a longer list is a bug or abuse. */
const MAX_WATCHED = 2000

const rootPaths = async (): Promise<string[]> =>
  (await fileRoots.current()).map((root) => root.path)

/** The path, once it is known to exist inside the workspace's roots. */
async function workspacePath(path: unknown, roots: string[]): Promise<string> {
  if (typeof path !== 'string' || path === '') throw new Error('Expected a path')
  if ((await resolveInsideRoots(path, roots)) === null) throw new Error('Not inside the workspace')
  return path
}

export function registerFileTreeIpc(): void {
  const windows = new Map<WebContents, { watchers: DirectoryWatchers; paths: string[] }>()

  handleTrusted(FILE_TREE_CHANNELS.list, async (_event, path) => {
    if (typeof path !== 'string' || path === '') throw new Error('listDirectory expects a path')
    return listDirectory(path, await fileRoots.current())
  })

  handleTrusted(FILE_TREE_CHANNELS.watch, async (event, paths) => {
    if (
      !Array.isArray(paths) ||
      paths.length > MAX_WATCHED ||
      !paths.every((path): path is string => typeof path === 'string' && path !== '')
    ) {
      throw new Error('watchDirectories expects a list of paths')
    }
    const sender = event.sender
    let entry = windows.get(sender)
    if (!entry) {
      const watchers = new DirectoryWatchers((changed) => {
        if (!sender.isDestroyed()) sender.send(FILE_TREE_CHANNELS.changed, changed)
      })
      entry = { watchers, paths: [] }
      windows.set(sender, entry)
      sender.once('destroyed', () => {
        watchers.close()
        windows.delete(sender)
      })
    }
    entry.paths = paths
    await entry.watchers.set(paths, await rootPaths())
  })

  handleTrusted(FILE_TREE_CHANNELS.copyPath, async (_event, path, form) => {
    if (form !== 'absolute' && form !== 'relative') throw new Error('Unknown path form')
    const roots = await rootPaths()
    const checked = await workspacePath(path, roots)
    const text = form === 'absolute' ? checked : rootRelativePath(checked, roots)
    if (text === null) throw new Error('A root folder has no relative path')
    return clipboard.writeText(text)
  })

  handleTrusted(FILE_TREE_CHANNELS.reveal, async (_event, path) => {
    shell.showItemInFolder(await workspacePath(path, await rootPaths()))
  })

  // A folder leaving the workspace stops being watched.
  fileRoots.onChange(() => {
    void rootPaths().then((roots) => {
      for (const { watchers, paths } of windows.values()) void watchers.set(paths, roots)
    })
  })
}
