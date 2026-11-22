import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { cssFontFamily } from '@/lib/css-font-family'
import { useEditorScheme } from '@/lib/editor-scheme'
import { useEditorTabStore } from '@/state/editor-tab-store'
import { useSettingsStore } from '@/state/settings-store'
import { editorDocument, saveDocument, viewStates } from './editor-documents'
import { monaco } from './monaco-environment'
import { type MenuColors, monacoTheme } from './monaco-theme'

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

/**
 * The Monaco editor of the editor tabs: one instance that shows the active tab's model, keeping
 * each tab's scroll position and cursor while another tab is shown.
 */
export function CodeEditor({
  path,
  ready,
  hidden,
  focusRequest
}: {
  path: string
  /** The tab's model is loaded. */
  ready: boolean
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
  const scheme = useEditorScheme(themeId)
  const appTheme = useSyncExternalStore(subscribeAppTheme, appThemeId)

  // Monaco has one theme for all its editors. Set before the editor is first painted with it.
  useLayoutEffect(() => {
    if (!scheme) return
    const name = `hatfield-${themeId}-${appTheme ?? 'default'}`
    monaco.editor.defineTheme(name, monacoTheme(scheme, menuColors()))
    monaco.editor.setTheme(name)
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
    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const active = useEditorTabStore.getState().activePath
      if (active) void saveDocument(active)
    })
    editor.current = instance
    return () => {
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
    if (!instance || !model || instance.getModel() === model) return
    const previous = shownPath.current
    const state = instance.saveViewState()
    if (previous && state) viewStates.set(previous, state)
    instance.setModel(model)
    const saved = viewStates.get(path)
    if (saved) instance.restoreViewState(saved)
    shownPath.current = path
  }, [path, ready])

  useEffect(() => {
    if (focusRequest > 0) editor.current?.focus()
  }, [focusRequest])

  return (
    <div
      ref={container}
      aria-label="Editor"
      data-path={path}
      // Shown once its theme is set, never in Monaco's own colours first.
      hidden={hidden || !ready || !scheme}
      // Monaco's theme colours are set on `.monaco-component`; its context menu, drawn in a shadow root
      // beside the editor, inherits them only from here.
      className="monaco-component min-h-0 flex-1"
    />
  )
}
