import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

const COMPONENTS: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      title={href}
      onClick={(event) => {
        // The window never navigates: only a web page opens, in the browser.
        event.preventDefault()
        if (href !== undefined && /^https?:\/\//i.test(href))
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

/** An agent's reply in a notification, as Markdown without raw HTML. */
export function NotificationMarkdown({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="markdown-preview notification-markdown">
      <Markdown remarkPlugins={[remarkGfm]} skipHtml components={COMPONENTS}>
        {text}
      </Markdown>
    </div>
  )
}
