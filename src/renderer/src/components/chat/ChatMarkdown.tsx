import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { defaultRehypePlugins, type Components } from 'streamdown'
import { MessageResponse } from '@/components/ai-elements/message'
import { useChatStore } from '@/state/chat-store'
import { CHAT_REFERENCE_CAP } from '../../../../shared/chat-agent-api'
import { parseCodeReference, type CodeReference } from '../../../../shared/chat-references'
import { FILE_REFERENCE_TAG, fileReferenceRehype } from './file-reference-rehype'

const LINK_CLASS =
  'cursor-pointer text-link underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

type ReplyFiles = {
  /** Each path the reply names that main found inside the workspace, to the file it opens. */
  resolved: ReadonlyMap<string, string>
  /** A rendered reference reports its path; a new identity asks every reference again. */
  named: (path: string) => void
}

const ReplyFilesContext = createContext<ReplyFiles>({ resolved: new Map(), named: () => undefined })

type Target = { reference: CodeReference; file: string }

/** The reference in `text` when it names a file the workspace has, with that file. */
function useTarget(text: string | null): Target | null {
  const { resolved, named } = useContext(ReplyFilesContext)
  const reference = text === null ? null : parseCodeReference(text)
  const path = reference?.path ?? null
  useEffect(() => {
    if (path !== null) named(path)
  }, [path, named])
  const file = path === null ? undefined : resolved.get(path)
  return reference === null || file === undefined ? null : { reference, file }
}

const open = ({ reference, file }: Target): void =>
  useChatStore.getState().openReference(file, reference.line, reference.column)

const textOf = (children: unknown): string | null =>
  typeof children === 'string'
    ? children
    : Array.isArray(children) && children.every((child) => typeof child === 'string')
      ? children.join('')
      : null

function InlineCode({
  children,
  className
}: {
  children?: React.ReactNode
  className?: string | undefined
}): React.JSX.Element {
  const target = useTarget(textOf(children))
  if (target === null) return <code className={className}>{children}</code>
  return (
    <button type="button" className={LINK_CLASS} onClick={() => open(target)}>
      <code>{children}</code>
    </button>
  )
}

function FileReference({ text }: { text: string }): React.JSX.Element {
  const target = useTarget(text)
  if (target === null) return <>{text}</>
  return (
    <button type="button" className={LINK_CLASS} onClick={() => open(target)}>
      {text}
    </button>
  )
}

function Link({
  href,
  children
}: {
  href?: string | undefined
  children?: React.ReactNode
}): React.JSX.Element {
  const target = useTarget(href ?? null)
  return (
    <a
      href={href}
      title={href}
      className={LINK_CLASS}
      onClick={(event) => {
        // The window never navigates: a reference opens the editor, a web page the browser.
        event.preventDefault()
        if (target !== null) open(target)
        else if (href !== undefined && /^https?:\/\//i.test(href))
          window.desktop
            .openWebLink(href)
            .catch((error: unknown) => console.error('Opening the link failed:', error))
      }}
    >
      {children}
    </a>
  )
}

const COMPONENTS: Components = {
  inlineCode: ({ children, className }) => (
    <InlineCode className={className}>{children}</InlineCode>
  ),
  [FILE_REFERENCE_TAG]: ({ children }) => <FileReference text={textOf(children) ?? ''} />,
  a: ({ href, children }) => <Link href={href}>{children}</Link>,
  // Images aren't loaded (remote ones could track the reader); their description stands in.
  img: ({ alt }) => <span className="markdown-image">[{alt || 'image'}]</span>
}

// After the defaults sanitize the tree, so the elements it adds are kept.
const REHYPE_PLUGINS = [...Object.values(defaultRehypePlugins), fileReferenceRehype]

/**
 * The files a finished reply's rendered references name, resolved by main in batches: the
 * references found in one render go in one call. Nothing is asked while the reply streams.
 */
function useReplyFiles(streaming: boolean): ReplyFiles {
  const [resolved, setResolved] = useState<ReadonlyMap<string, string>>(new Map())
  const batch = useRef({ pending: new Set<string>(), requested: new Set<string>(), alive: true })

  useEffect(() => {
    const state = batch.current
    state.alive = true
    return () => {
      state.alive = false
    }
  }, [])

  const flush = useCallback(() => {
    const state = batch.current
    const room = Math.max(0, CHAT_REFERENCE_CAP - state.requested.size)
    const paths = [...state.pending].slice(0, room)
    state.pending.clear()
    const { chatId } = useChatStore.getState()
    if (chatId === null || paths.length === 0) return
    for (const path of paths) state.requested.add(path)
    window.desktop
      .resolveChatPaths(chatId, paths)
      .then((files) => {
        const found = paths.flatMap((path, index) => {
          const file = files[index]
          return typeof file === 'string' ? [[path, file] as const] : []
        })
        if (state.alive && found.length > 0)
          setResolved((previous) => new Map([...previous, ...found]))
      })
      .catch((error: unknown) => console.error("Resolving the reply's files failed:", error))
  }, [])

  const named = useCallback(
    (path: string) => {
      const state = batch.current
      if (streaming || state.requested.has(path)) return
      if (state.pending.size === 0) queueMicrotask(flush)
      state.pending.add(path)
    },
    [streaming, flush]
  )

  return useMemo(() => ({ resolved, named }), [resolved, named])
}

/** A reply as Markdown, without raw HTML, with the workspace files it names as links. */
export function ChatMarkdown({
  text,
  streaming
}: {
  text: string
  streaming: boolean
}): React.JSX.Element {
  const files = useReplyFiles(streaming)
  return (
    <ReplyFilesContext.Provider value={files}>
      <MessageResponse
        className="markdown-preview chat-markdown"
        components={COMPONENTS}
        rehypePlugins={REHYPE_PLUGINS}
        skipHtml
        linkSafety={{ enabled: false }}
        isAnimating={streaming}
      >
        {text}
      </MessageResponse>
    </ReplyFilesContext.Provider>
  )
}
