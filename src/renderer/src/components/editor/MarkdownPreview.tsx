import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cssFontFamily } from '@/lib/css-font-family'
import { useEditorTabStore } from '@/state/editor-tab-store'
import { useFileTreeStore } from '@/state/file-tree-store'
import { useSettingsStore } from '@/state/settings-store'
import { editorDocument } from './editor-documents'
import { headingSlug, markdownLinkTarget } from './markdown-link-target'

export const isMarkdown = (path: string): boolean => /\.(md|markdown)$/i.test(path)

/** A heading a link in another file's preview points at, scrolled to once that file shows. */
const pendingHeadings = new Map<string, string>()

/** Scrolls the preview to the heading whose anchor is `slug`; false when there is none. */
function scrollToHeading(container: HTMLElement | null, slug: string): boolean {
  if (!container) return false
  const seen = new Map<string, number>()
  const wanted = slug.toLowerCase()
  for (const heading of container.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    if (headingSlug(heading.textContent, seen) !== wanted) continue
    heading.scrollIntoView({ block: 'start' })
    return true
  }
  return false
}

/** The workspace folder the file is in, the innermost one when they nest. */
function rootOf(path: string): string | null {
  const inside = useFileTreeStore
    .getState()
    .roots.map((root) => root.path)
    .filter((root) => path.startsWith(root) && /^[\\/]/.test(path.slice(root.length)))
  return inside.toSorted((a, b) => b.length - a.length)[0] ?? null
}

/** Follows a link: a web page opens in the browser, a heading or a file in the app. */
function follow(href: string, from: string, container: HTMLElement | null): void {
  const target = markdownLinkTarget(href, from, rootOf(from))
  if (target === null) return
  if (target.kind === 'web') {
    window.desktop
      .openWebLink(target.url)
      .catch((error: unknown) => console.error('Opening the link failed:', error))
    return
  }
  if (target.kind === 'heading' || target.path === from) {
    if (target.slug !== null) scrollToHeading(container, target.slug)
    return
  }
  const { open, togglePreview } = useEditorTabStore.getState()
  open(target.path)
  if (!isMarkdown(target.path)) return
  if (target.slug !== null) pendingHeadings.set(target.path, target.slug)
  const tab = useEditorTabStore.getState().tabs.find((each) => each.path === target.path)
  if (tab && !tab.preview) togglePreview(target.path)
}

const COMPONENTS: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      title={href}
      onClick={(event) => {
        // The window never navigates: the app follows the link itself, or nothing happens.
        event.preventDefault()
        const preview = event.currentTarget.closest<HTMLElement>('[data-markdown-path]')
        const from = preview?.dataset['markdownPath']
        if (href !== undefined && preview && from !== undefined) follow(href, from, preview)
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

  // Opened from a link to one of its headings.
  useLayoutEffect(() => {
    const slug = pendingHeadings.get(path)
    if (slug === undefined) return
    pendingHeadings.delete(path)
    scrollToHeading(container.current, slug)
  }, [path])

  return (
    <div
      ref={container}
      aria-label="Markdown preview"
      data-markdown-path={path}
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
