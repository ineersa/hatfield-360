import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cssFontFamily } from '@/lib/css-font-family'
import { useSettingsStore } from '@/state/settings-store'
import { editorDocument } from './editor-documents'

/** Only web links leave the app, through main, which checks them again. */
const isWebLink = (href: string | undefined): href is string => /^https?:\/\//i.test(href ?? '')

const COMPONENTS: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      title={href}
      onClick={(event) => {
        // The window never navigates: a link opens in the browser or not at all.
        event.preventDefault()
        if (isWebLink(href)) {
          window.desktop
            .openWebLink(href)
            .catch((error: unknown) => console.error('Opening the link failed:', error))
        }
      }}
    >
      {children}
    </a>
  ),
  // Images aren't loaded (remote ones could track the reader); their description stands in.
  img: ({ alt }) => <span className="markdown-image">[{alt || 'image'}]</span>
}

/**
 * The rendered preview of a Markdown tab, following its text as it is edited. Raw HTML in the file
 * is skipped, so nothing in it becomes a script, a frame or a remote load.
 */
export function MarkdownPreview({ path }: { path: string }): React.JSX.Element {
  const fontFamily = useSettingsStore((state) => state.values['editor.fontFamily'])
  const container = useRef<HTMLDivElement>(null)
  const subscribe = useCallback(
    (onChange: () => void) => {
      const subscription = editorDocument(path)?.onDidChangeContent(onChange)
      return () => subscription?.dispose()
    },
    [path]
  )
  const text = useSyncExternalStore(subscribe, () => editorDocument(path)?.getValue() ?? '')

  // Code in the preview uses the editor's font.
  useLayoutEffect(() => {
    container.current?.style.setProperty('--editor-font-family', cssFontFamily(fontFamily))
  }, [fontFamily])

  return (
    <div
      ref={container}
      aria-label="Markdown preview"
      className="min-h-0 flex-1 overflow-y-auto px-8 py-6"
    >
      <div className="markdown-preview mx-auto max-w-3xl">
        <Markdown remarkPlugins={[remarkGfm]} skipHtml components={COMPONENTS}>
          {text}
        </Markdown>
      </div>
    </div>
  )
}
