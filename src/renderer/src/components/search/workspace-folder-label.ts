import { useMemo } from 'react'
import { separatorOf } from '@/components/editor/editor-tab-labels'
import { treeRoots } from '@/components/files/file-tree-rows'
import { useWorkspaceStore } from '@/state/workspace-store'
import { useWorktreeStore } from '@/state/worktree-store'

/** A folder results are shown under: a workspace folder or a worktree, by its name. */
export type NamedFolder = { path: string; name: string }

/** The workspace folders and their worktrees, which results are labelled from. */
export function useNamedFolders(): NamedFolder[] {
  const folders = useWorkspaceStore((state) => state.workspace?.folders)
  const projects = useWorktreeStore((state) => state.projects)
  return useMemo(
    () =>
      treeRoots(folders ?? [], projects).flatMap((root) => [
        { path: root.path, name: root.name },
        ...[...root.worktrees, ...Object.values(root.nested).flat()].map((tree) => ({
          path: tree.path,
          name: tree.name
        }))
      ]),
    [folders, projects]
  )
}

/** Where a file is, from the workspace folder it is in: `app/src/deep`, or `src/deep` without the folder's name. */
export function folderLabel(path: string, folders: NamedFolder[], withName = true): string {
  const separator = separatorOf(path)
  const folder = path.slice(0, path.lastIndexOf(separator))
  const root = folders
    .filter((each) => folder === each.path || folder.startsWith(each.path + separator))
    .toSorted((a, b) => b.path.length - a.path.length)[0]
  if (!root) return folder
  const inside = folder
    .slice(root.path.length + 1)
    .split(separator)
    .join('/')
  return [withName ? root.name : '', inside].filter(Boolean).join('/')
}
