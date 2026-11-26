import { createContext, useContext, useEffect, useState } from 'react'
import { defaultRehypePlugins, type Components } from 'streamdown'
import { MessageResponse } from '@/components/ai-elements/message'
import { useChatStore } from '@/state/chat-store'
import { CHAT_REFERENCE_CAP } from '../../../../shared/chat-agent-api'
import {
  findCodeReferences,
  parseCodeReference,
  type CodeReference
} from '../../../../shared/chat-references'
import { FILE_REFERENCE_TAG, fileReferenceRehype } from './file-reference-rehype'

const LINK_CLASS =
  'cursor-pointer text-link underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

/** Each path the reply names that main found inside the workspace, to the file it opens. */
const ResolvedFiles = createContext<ReadonlyMap<string, string>>(new Map())

type Target = { reference: CodeReference; file: string }

/** The reference in `text` when it names a file the workspace has, with that file. */
function useTarget(text: string | null): Target | null {
  const resolved = useContext(ResolvedFiles)
  const reference = text === null ? null : parseCodeReference(text)
  const file = reference === null ? undefined : resolved.get(reference.path)
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

/** Every path the reply may name, in prose, inline code or a link target, up to the cap. */
const namedPaths = (text: string): string[] => {
  const paths = new Set(findCodeReferences(text).map(({ reference }) => reference.path))
  for (const [, code, target] of text.matchAll(/`([^`\n]+)`|\]\(([^)\s]+)\)/g)) {
    const reference = parseCodeReference(code ?? target ?? '')
    if (reference !== null) paths.add(reference.path)
  }
  return [...paths].slice(0, CHAT_REFERENCE_CAP)
}

/** The files a finished reply names, resolved by main in one call; none while it streams. */
function useResolvedFiles(text: string, streaming: boolean): ReadonlyMap<string, string> {
  const chatId = useChatStore((state) => state.chatId)
  const [resolved, setResolved] = useState<ReadonlyMap<string, string>>(new Map())
  useEffect(() => {
    const paths = streaming || chatId === null ? [] : namedPaths(text)
    let current = paths.length > 0
    if (chatId === null || !current) return () => undefined
    window.desktop
      .resolveChatPaths(chatId, paths)
      .then((files) => {
        if (!current) return
        const found = new Map<string, string>()
        paths.forEach((path, index) => {
          const file = files[index]
          if (typeof file === 'string') found.set(path, file)
        })
        setResolved(found)
      })
      .catch((error: unknown) => console.error("Resolving the reply's files failed:", error))
    return () => {
      current = false
    }
  }, [text, streaming, chatId])
  return resolved
}

/** A reply as Markdown, without raw HTML, with the workspace files it names as links. */
export function ChatMarkdown({
  text,
  streaming
}: {
  text: string
  streaming: boolean
}): React.JSX.Element {
  const resolved = useResolvedFiles(text, streaming)
  return (
    <ResolvedFiles.Provider value={resolved}>
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
    </ResolvedFiles.Provider>
  )
}
