import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useChatStore } from '@/state/chat-store'
import { parseCodeReference } from '../../../../shared/chat-references'

const LINK_CLASS =
  'cursor-pointer text-link underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

const follow = (text: string): boolean => {
  const reference = parseCodeReference(text)
  if (reference === null) return false
  useChatStore.getState().followLink(reference.path, reference.line, reference.endLine)
  return true
}

const COMPONENTS: Components = {
  // A `path:line` in a reply opens the editor there.
  code: ({ children, className }) => {
    const text = typeof children === 'string' ? children : null
    if (
      className === undefined &&
      text !== null &&
      !text.includes('\n') &&
      parseCodeReference(text) !== null
    ) {
      return (
        <button type="button" className={LINK_CLASS} onClick={() => follow(text)}>
          <code>{text}</code>
        </button>
      )
    }
    return <code className={className}>{children}</code>
  },
  a: ({ href, children }) => (
    <a
      href={href}
      title={href}
      className={LINK_CLASS}
      onClick={(event) => {
        // The window never navigates: a reference opens the editor, a web page the browser.
        event.preventDefault()
        if (href === undefined || follow(href)) return
        if (/^https?:\/\//i.test(href))
          window.desktop
            .openWebLink(href)
            .catch((error: unknown) => console.error('Opening the link failed:', error))
      }}
    >
      {children}
    </a>
  ),
  // Images aren't loaded (remote ones could track the reader); their description stands in.
  img: ({ alt }) => <span className="markdown-image">[{alt || 'image'}]</span>
}

/** A reply as Markdown, without raw HTML, with its code references as links. */
export function ChatMarkdown({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="markdown-preview chat-markdown">
      <Markdown remarkPlugins={[remarkGfm]} skipHtml components={COMPONENTS}>
        {text}
      </Markdown>
    </div>
  )
}
