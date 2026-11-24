import { useEffect } from 'react'
import { useAppInfoStore } from '@/state/app-info-store'
import { type EditorCaret, useEditorCaretStore } from '@/state/editor-selection'
import { LanguageServerStatus } from './LanguageServerStatus'

/** `2:22`, or `2:22 (10 chars, 1 line break)` with a selection, as JetBrains shows it. */
function caretLabel({ line, column, chars, lineBreaks }: EditorCaret): string {
  if (chars === 0) return `${line}:${column}`
  const parts = [`${chars} ${chars === 1 ? 'char' : 'chars'}`]
  if (lineBreaks > 0) parts.push(`${lineBreaks} ${lineBreaks === 1 ? 'line break' : 'line breaks'}`)
  return `${line}:${column} (${parts.join(', ')})`
}

/** The shown editor's caret, line separator, encoding and indentation; main reads and writes text as UTF-8. */
function EditorStatus(): React.JSX.Element | null {
  const caret = useEditorCaretStore((state) => state.caret)
  if (!caret) return null
  return (
    <>
      <span role="status" aria-label="Caret position">
        {caretLabel(caret)}
      </span>
      <span aria-label="Line separator">{caret.lineSeparator}</span>
      <span aria-label="File encoding">UTF-8</span>
      <span aria-label="Indentation">{caret.indent}</span>
    </>
  )
}

export function StatusBar(): React.JSX.Element {
  const appInfo = useAppInfoStore((state) => state.appInfo)
  const error = useAppInfoStore((state) => state.error)
  const loadAppInfo = useAppInfoStore((state) => state.loadAppInfo)

  useEffect(() => {
    void loadAppInfo()
  }, [loadAppInfo])

  return (
    <footer className="type-status flex min-h-status-bar shrink-0 items-center justify-end gap-3 px-3 py-0.5">
      <LanguageServerStatus />
      <EditorStatus />
      {error ? (
        <span role="alert" className="truncate text-error">
          Could not load app info: {error}
        </span>
      ) : (
        <span data-testid="app-info" className="truncate">
          {appInfo
            ? `Hatfield 360 v${appInfo.version} · Electron ${appInfo.electronVersion} · ${appInfo.platform}`
            : 'Loading…'}
        </span>
      )}
    </footer>
  )
}
