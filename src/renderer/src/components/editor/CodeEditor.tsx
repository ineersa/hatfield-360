import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { cssFontFamily } from '@/lib/css-font-family'
import { useEditorScheme } from '@/lib/editor-scheme'
import { useEditorTabStore } from '@/state/editor-tab-store'
import { useFileTreeStore } from '@/state/file-tree-store'
import { useSettingsStore } from '@/state/settings-store'
import {
  setEditorCaret,
  setEditorPromptContextSource,
  setEditorSelectionSource
} from '@/state/editor-selection'
import { editorViewState, setEditorViewState } from '@/state/editor-view-states'
import { editorDocument, saveDocument } from './editor-documents'
import { editorColorTheme, type MenuColors } from './editor-color-theme'
import { installEditorKeymap } from './editor-keymap'
import { revealJumpTarget } from './editor-navigation'
import type { LineRange } from '../../../../shared/file-tree-api'
import { monaco, setColorTheme } from './monaco-environment'

installEditorKeymap(() => {
  const active = useEditorTabStore.getState().activePath
  if (active) void saveDocument(active)
})

/** The page's app theme (`data-theme`), which changes after the editor's own effects run. */
function subscribeAppTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => observer.disconnect()
}
const appThemeId = (): string | undefined => document.documentElement.dataset.theme

/** The current app theme's popup colours, read from its stylesheet. */
function menuColors(): MenuColors {
  const style = getComputedStyle(document.documentElement)
  const role = (name: string): string => style.getPropertyValue(`--${name}`).trim()
  return {
    background: role('popover'),
    foreground: role('popover-foreground'),
    border: role('popover-border'),
    selection: role('popover-selection'),
    selectionForeground: role('popover-selection-foreground'),
    separator: role('separator')
  }
}

const indentLabel = ({
  insertSpaces,
  indentSize
}: monaco.editor.TextModelResolvedOptions): string =>
  insertSpaces ? `${indentSize} ${indentSize === 1 ? 'space' : 'spaces'}` : 'Tab'

/** Tells the status bar where the caret is, how much is selected and how the file is laid out. */
function publishCaret(instance: monaco.editor.IStandaloneCodeEditor): void {
  const selection = instance.getSelection()
  const model = instance.getModel()
  if (!selection || !model) return
  setEditorCaret({
    line: selection.positionLineNumber,
    column: selection.positionColumn,
    chars: model.getValueLengthInRange(selection),
    lineBreaks: selection.endLineNumber - selection.startLineNumber,
    lineSeparator: model.getEOL() === '\r\n' ? 'CRLF' : 'LF',
    indent: indentLabel(model.getOptions())
  })
}

/** The selected lines, or the caret's; a selection ending at a line's start leaves that line out. */
function referencedLines(selection: monaco.Selection): LineRange {
  const { startLineNumber: start, endLineNumber: end, endColumn } = selection
  return { start, end: end > start && endColumn === 1 ? end - 1 : end }
}

/**
 * The Monaco editor of the editor tabs: one instance that shows the active tab's model, keeping
 * each tab's scroll position and cursor while another tab is shown.
 */
export function CodeEditor({
  path,
  ready,
  readOnly,
  hidden,
  focusRequest
}: {
  path: string
  /** The tab's model is loaded. */
  ready: boolean
  /** Shows the text without letting it be edited: a large file's start. */
  readOnly: boolean
  hidden: boolean
  /** Changes when the editor should take the keys, as when its tab is clicked. */
  focusRequest: number
}): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null)
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const shownPath = useRef<string | null>(null)
  const themeId = useSettingsStore((state) => state.values['editor.colorTheme'])
  const fontFamily = useSettingsStore((state) => state.values['editor.fontFamily'])
  const fontSize = useSettingsStore((state) => state.values['editor.fontSize'])
  const lineHeight = useSettingsStore((state) => state.values['editor.lineHeight'])
  const reveal = useEditorTabStore((state) => state.reveal)
  const scheme = useEditorScheme(themeId)
  const appTheme = useSyncExternalStore(subscribeAppTheme, appThemeId)

  // One theme for all editors, set before the editor is first shown with it.
  const [themed, setThemed] = useState(false)
  useEffect(() => {
    if (!scheme) return undefined
    let current = true
    setColorTheme(
      `${themeId} (${appTheme ?? 'default'})`,
      editorColorTheme(scheme, menuColors())
    ).then(
      () => current && setThemed(true),
      (error: unknown) => console.error('Setting the editor theme failed:', error)
    )
    return () => {
      current = false
    }
  }, [scheme, themeId, appTheme])

  useEffect(() => {
    const element = container.current
    if (!element) return undefined
    const instance = monaco.editor.create(element, {
      model: null,
      // Lays out again when the tab area is resized or shown after another view.
      automaticLayout: true,
      // As in JetBrains IDEs: no minimap or empty breakpoint margin, the caret row filled to the gutter.
      minimap: { enabled: false },
      glyphMargin: false,
      renderLineHighlight: 'all',
      fixedOverflowWidgets: true
    })
    // Cursor, scroll and folds are kept as they change, so a restart finds them as they were left.
    // Not while hidden, where the editor lays out at no size, nor while the model is being swapped.
    const record = (): void => {
      const shown = shownPath.current
      const state = instance.saveViewState()
      if (shown && state && element.offsetParent !== null) setEditorViewState(shown, state)
    }
    instance.onDidChangeCursorPosition(record)
    instance.onDidScrollChange(record)
    instance.onDidChangeHiddenAreas(record)
    instance.onDidChangeCursorSelection(() => publishCaret(instance))
    // Indentation is detected from the text once it loads.
    instance.onDidChangeModelOptions(() => publishCaret(instance))
    // JetBrains' Copy Reference: the file from its root folder, with the caret's or selection's lines.
    instance.addAction({
      id: 'hatfield.editor.copyReference',
      label: 'Copy Reference',
      contextMenuGroupId: '9_cutcopypaste',
      contextMenuOrder: 5,
      run: () => {
        const shown = shownPath.current
        const selection = instance.getSelection()
        if (shown && selection) {
          useFileTreeStore.getState().copyPath(shown, 'relative', referencedLines(selection))
        }
      }
    })
    editor.current = instance
    setEditorSelectionSource(() => {
      const selection = instance.getSelection()
      const model = instance.getModel()
      if (!instance.hasTextFocus() || !selection || !model || selection.isEmpty()) return null
      if (selection.startLineNumber !== selection.endLineNumber) return null
      return model.getValueInRange(selection)
    })
    setEditorPromptContextSource(() => {
      const model = instance.getModel()
      const file = shownPath.current
      if (!model || file === null) return { file: null, selection: null }
      const selection = instance.getSelection()
      if (!selection) return { file, selection: null }
      // With nothing selected, the caret's line stands for the selection.
      const text = selection.isEmpty() ? '' : model.getValueInRange(selection)
      return { file, selection: { ...referencedLines(selection), text } }
    })
    return () => {
      setEditorSelectionSource(null)
      setEditorPromptContextSource(null)
      setEditorCaret(null)
      instance.dispose()
      editor.current = null
      shownPath.current = null
    }
  }, [])

  useEffect(() => {
    // Monaco takes a line height under 8 as a multiple of the font size, as the setting is.
    editor.current?.updateOptions({ fontFamily: cssFontFamily(fontFamily), fontSize, lineHeight })
  }, [fontFamily, fontSize, lineHeight])

  useEffect(() => {
    const instance = editor.current
    const model = ready ? editorDocument(path) : undefined
    if (!instance || !model) return
    if (instance.getModel() !== model) {
      const previous = shownPath.current
      const state = instance.saveViewState()
      if (previous && state) setEditorViewState(previous, state)
      shownPath.current = null
      instance.setModel(model)
      // Saved by an older session, it may no longer fit; the file then opens at its top.
      const saved = editorViewState(path)
      if (saved) {
        try {
          instance.restoreViewState(saved)
        } catch (error) {
          console.error('Restoring the editor position failed:', error)
        }
      }
      revealJumpTarget(instance, path)
      shownPath.current = path
    }
    // A file opened at a position (a search result) shows it once its model is in and on screen:
    // a hidden editor can't take the keys.
    if (reveal?.path !== path || hidden || !themed) return
    if (reveal.line !== null) {
      const range = new monaco.Range(reveal.line, reveal.start + 1, reveal.line, reveal.end + 1)
      instance.setSelection(range)
      instance.revealRangeInCenter(range)
    }
    if (reveal.focus) instance.focus()
    useEditorTabStore.getState().revealDone()
  }, [path, ready, reveal, hidden, themed])

  // The status bar shows the caret while the editor is on screen.
  useEffect(() => {
    const instance = editor.current
    if (!instance || hidden || !ready || !themed) setEditorCaret(null)
    else publishCaret(instance)
  }, [hidden, ready, themed])

  useEffect(() => {
    editor.current?.updateOptions({ readOnly })
  }, [readOnly])

  useEffect(() => {
    if (focusRequest > 0) editor.current?.focus()
  }, [focusRequest])

  return (
    <div
      ref={container}
      aria-label="Editor"
      data-path={path}
      // Shown once its theme is set, never in Monaco's own colours first.
      hidden={hidden || !ready || !themed}
      // Monaco's theme colours are set on `.monaco-component`; its context menu, drawn in a shadow root
      // beside the editor, inherits them only from here.
      className="monaco-component min-h-0 flex-1"
    />
  )
}
