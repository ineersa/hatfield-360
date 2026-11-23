import { useEditorTabStore } from '@/state/editor-tab-store'
import { monaco } from './monaco-environment'

type RevealTarget = monaco.IRange | monaco.IPosition

/** Where each file opened by a jump (Go to Definition, a reference) should show, once its tab does. */
const reveals = new Map<string, RevealTarget>()

// A jump into another file opens it in a tab; one inside the same file stays with the editor.
monaco.editor.registerEditorOpener({
  openCodeEditor(source, resource, selectionOrPosition) {
    if (resource.scheme !== 'file' || source.getModel()?.uri.toString() === resource.toString()) {
      return false
    }
    const path = resource.fsPath
    if (selectionOrPosition) reveals.set(path, selectionOrPosition)
    useEditorTabStore.getState().open(path)
    return true
  }
})

/** Moves the editor to where a jump into its file pointed, if one did. */
export function revealJumpTarget(editor: monaco.editor.ICodeEditor, path: string): void {
  const target = reveals.get(path)
  if (!target) return
  reveals.delete(path)
  if ('lineNumber' in target) {
    editor.setPosition(target)
    editor.revealPositionInCenterIfOutsideViewport(target)
  } else {
    editor.setSelection(target)
    editor.revealRangeInCenterIfOutsideViewport(target)
  }
  editor.focus()
}

/** Files in a dependency folder open read-only, as in JetBrains IDEs. */
export const isDependencyFile = (path: string): boolean => /[/\\]node_modules[/\\]/.test(path)
