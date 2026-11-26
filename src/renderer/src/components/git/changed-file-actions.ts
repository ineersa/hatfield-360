import { useEditorTabStore } from '@/state/editor-tab-store'
import { useHunkTabStore } from '@/state/hunk-tab-store'
import { useShellLayoutStore } from '@/state/shell-layout-store'
import type { ChangedFile, SourceControlGroup } from '../../../../shared/source-control-api'

export const fileNameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

/** Opens the file in the editor, in the Files view, as the Files tree does. */
export function openInEditor(absolutePath: string): void {
  useShellLayoutStore.getState().showFiles()
  useEditorTabStore.getState().open(absolutePath)
}

/** The file's changes in hunk, in a tab in the Git view. */
export function showDiff(
  group: Pick<SourceControlGroup, 'root' | 'name'>,
  file: ChangedFile
): void {
  useHunkTabStore
    .getState()
    .open(
      { kind: 'diff', path: file.path },
      group.root,
      `${fileNameOf(file.path)} · ${group.name}`,
      file.absolutePath
    )
}
