import {
  ArrowDown,
  Check,
  ChevronRight,
  Circle,
  FilePen,
  Loader,
  Map as MapIcon,
  Plus,
  Send,
  Square,
  X,
  XCircle
} from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import {
  SIDE_PANEL_HANDLE_WIDTH,
  SidePanelResizeHandle
} from '@/components/shell/SidePanelResizeHandle'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/class-names'
import { cssFontFamily } from '@/lib/css-font-family'
import { useChatStore } from '@/state/chat-store'
import type { ChatItem } from '@/state/chat-transcript'
import { useSettingsStore } from '@/state/settings-store'
import { SIDE_PANEL_MIN_WIDTH, useShellLayoutStore } from '@/state/shell-layout-store'
import type { ChatConfigId, ChatToolStatus } from '../../../../shared/chat-agent-api'
import { ChatMarkdown } from './ChatMarkdown'

const ICON_BUTTON =
  'flex size-icon-button shrink-0 items-center justify-center rounded-button text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50 disabled:hover:bg-transparent'

function IconButton({
  label,
  onClick,
  disabled = false,
  children
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className={ICON_BUTTON}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

const STATUS_LABEL: Record<ChatToolStatus, string> = {
  pending: 'Pending',
  in_progress: 'Running',
  completed: 'Done',
  failed: 'Failed'
}

function ToolStatusIcon({ status }: { status: ChatToolStatus }): React.JSX.Element {
  const props = { className: 'size-3.5 shrink-0', strokeWidth: 2, 'aria-hidden': true } as const
  if (status === 'completed')
    return <Check {...props} className={cn(props.className, 'text-success')} />
  if (status === 'failed')
    return <XCircle {...props} className={cn(props.className, 'text-error')} />
  if (status === 'in_progress')
    return (
      <Loader {...props} className={cn(props.className, 'animate-spin text-muted-foreground')} />
    )
  return <Circle {...props} className={cn(props.className, 'text-muted-foreground')} />
}

/** A collapsed section, opened to show what a tool got and gave, or a thought. */
function Disclosure({
  summary,
  label,
  children
}: {
  summary: React.ReactNode
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <details aria-label={label} className="group rounded-component border border-separator">
      <summary className="flex h-tree-row cursor-pointer list-none items-center gap-1.5 px-2 hover:bg-hover [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
          aria-hidden
        />
        {summary}
      </summary>
      <div className="flex flex-col gap-2 border-t border-separator p-2">{children}</div>
    </details>
  )
}

const Code = ({ text }: { text: string }): React.JSX.Element => (
  <pre className="chat-code max-h-64 overflow-auto rounded-component bg-frame p-2 whitespace-pre-wrap">
    {text}
  </pre>
)

function Item({ item, busy }: { item: ChatItem; busy: boolean }): React.JSX.Element {
  const answer = useChatStore((state) => state.answerPermission)
  switch (item.kind) {
    case 'user':
      return (
        <div
          aria-label="Your message"
          className="ml-8 self-end rounded-component bg-selection px-3 py-2 whitespace-pre-wrap text-selection-foreground"
        >
          {item.text}
        </div>
      )
    case 'assistant':
      return (
        <div aria-label="Claude's reply">
          <ChatMarkdown text={item.text} />
        </div>
      )
    case 'thought':
      return (
        <Disclosure label="Thinking" summary={<span className="type-hint">Thinking</span>}>
          <p className="type-hint whitespace-pre-wrap">{item.text}</p>
        </Disclosure>
      )
    case 'tool':
      return (
        <Disclosure
          label={`Tool: ${item.title}`}
          summary={
            <>
              <ToolStatusIcon status={item.status} />
              <span className="min-w-0 flex-1 truncate">{item.title}</span>
              <span className="type-hint shrink-0">{STATUS_LABEL[item.status]}</span>
            </>
          }
        >
          {item.input === null ? null : <Code text={item.input} />}
          {item.output === null ? null : <Code text={item.output} />}
          {item.input === null && item.output === null ? (
            <p className="type-hint">Nothing to show.</p>
          ) : null}
        </Disclosure>
      )
    case 'permission':
      return (
        <section
          aria-label="Permission request"
          className="flex flex-col gap-2 rounded-component border border-warning-border bg-warning-background p-3"
        >
          <p>
            Allow <span className="font-mono">{item.title}</span>?
          </p>
          {item.answer === null ? (
            <div className="flex flex-wrap gap-2">
              {item.options.map((option) => (
                <button
                  key={option.optionId}
                  type="button"
                  disabled={!busy}
                  onClick={() => answer(item.requestId, option.optionId, option.name)}
                  className={cn(
                    'type-button h-control rounded-button border px-3 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                    option.kind.startsWith('allow')
                      ? 'border-transparent bg-primary text-primary-foreground'
                      : 'border-button-border bg-button text-button-foreground hover:bg-hover'
                  )}
                >
                  {option.name}
                </button>
              ))}
            </div>
          ) : (
            <p className="type-hint">{item.answer}</p>
          )}
        </section>
      )
  }
  return (
    <p
      role={item.tone === 'error' ? 'alert' : undefined}
      className={cn('type-hint whitespace-pre-wrap', item.tone === 'error' && 'text-error')}
    >
      {item.text}
    </p>
  )
}

/** How close to the end counts as following the conversation. */
const AT_END_PX = 24

/**
 * The conversation, scrolled: it follows new output while it shows the end, and stays where the
 * user scrolled to otherwise, with a button back to the end.
 */
const scrollToEnd = (element: HTMLElement | null): void => {
  if (element) element.scrollTop = element.scrollHeight
}

function Conversation({ children }: { children: React.ReactNode }): React.JSX.Element {
  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const [atEnd, setAtEnd] = useState(true)
  useLayoutEffect(() => {
    const element = content.current
    if (!element) return undefined
    // Streamed text grows the content without a render here; a resize catches every change.
    const observer = new ResizeObserver(() => {
      const view = scroller.current
      // Content that fits (a new chat) is followed again from its start.
      if (view && view.scrollHeight <= view.clientHeight + AT_END_PX) {
        following.current = true
        setAtEnd(true)
      }
      if (following.current) scrollToEnd(view)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scroller}
        className="h-full overflow-y-auto"
        onScroll={(event) => {
          const element = event.currentTarget
          const end = element.scrollHeight - element.scrollTop - element.clientHeight <= AT_END_PX
          following.current = end
          setAtEnd(end)
        }}
      >
        <div
          ref={content}
          role="log"
          aria-label="Conversation"
          className="flex flex-col gap-3 px-4 py-2"
        >
          {children}
        </div>
      </div>
      {atEnd ? null : (
        <button
          type="button"
          aria-label="Scroll to the latest"
          onClick={() => {
            following.current = true
            scrollToEnd(scroller.current)
          }}
          className="absolute bottom-2 left-1/2 flex size-icon-button -translate-x-1/2 items-center justify-center rounded-button border border-button-border bg-button text-button-foreground hover:bg-hover"
        >
          <ArrowDown className="size-4" aria-hidden />
        </button>
      )}
    </div>
  )
}

const PICKERS: { id: ChatConfigId; label: string }[] = [
  { id: 'mode', label: 'Mode' },
  { id: 'model', label: 'Model' },
  { id: 'effort', label: 'Effort' }
]

function ConfigPickers(): React.JSX.Element {
  const options = useChatStore((state) => state.configOptions)
  const setConfig = useChatStore((state) => state.setConfig)
  return (
    <div className="flex min-w-0 flex-1 gap-1">
      {PICKERS.map(({ id, label }) => {
        const option = options.find((each) => each.id === id)
        if (!option) return null
        return (
          <select
            key={id}
            aria-label={label}
            title={label}
            value={option.currentValue}
            onChange={(event) => setConfig(id, event.target.value)}
            className="type-hint h-control min-w-0 flex-1 truncate rounded-component border border-input-border bg-input px-1 text-input-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {option.options.map((choice) => (
              <option
                key={choice.value}
                value={choice.value}
                title={choice.description ?? undefined}
              >
                {choice.name}
              </option>
            ))}
          </select>
        )
      })}
    </div>
  )
}

function Composer(): React.JSX.Element {
  const status = useChatStore((state) => state.status)
  const send = useChatStore((state) => state.send)
  const stop = useChatStore((state) => state.stop)
  const [text, setText] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  const busy = status === 'busy'
  useLayoutEffect(() => {
    input.current?.focus()
  }, [])
  const submit = (): void => {
    if (send(text)) setText('')
  }
  return (
    <form
      className="flex shrink-0 flex-col gap-1.5 border-t border-separator p-2"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <textarea
        ref={input}
        aria-label="Message"
        rows={3}
        value={text}
        placeholder="Ask about the workspace. @selection and @file refer to the editor."
        disabled={status === 'ended' || status === 'none'}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            submit()
          }
        }}
        className="max-h-48 min-h-control resize-none rounded-component border border-input-border bg-input px-2 py-1.5 text-input-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      />
      <div className="flex items-center gap-1">
        <ConfigPickers />
        {busy ? (
          <IconButton label="Stop (Esc)" onClick={stop}>
            <Square className="size-4" aria-hidden />
          </IconButton>
        ) : (
          <IconButton
            label="Send (Enter)"
            onClick={submit}
            disabled={status !== 'ready' || text.trim() === ''}
          >
            <Send className="size-4" aria-hidden />
          </IconButton>
        )}
      </div>
    </form>
  )
}

/** Claude in the workspace, on the right: opened and closed with Shift Shift, resized from its left edge. */
export function ChatPanel(): React.JSX.Element {
  const width = useShellLayoutStore((state) => state.chatWidth)
  const setWidth = useShellLayoutStore((state) => state.setChatWidth)
  const fontFamily = useSettingsStore((state) => state.values['editor.fontFamily'])
  const { chatId, status, items, error, newChat, close, stop, generateMap, editMap } =
    useChatStore()
  const aside = useRef<HTMLElement>(null)
  const busy = status === 'busy'
  useLayoutEffect(() => {
    aside.current?.style.setProperty('--editor-font-family', cssFontFamily(fontFamily))
  }, [fontFamily])
  const maxWidth = (): number =>
    Math.max(
      SIDE_PANEL_MIN_WIDTH,
      (aside.current?.parentElement?.clientWidth ?? 0) / 2 - SIDE_PANEL_HANDLE_WIDTH
    )
  return (
    <>
      <SidePanelResizeHandle
        label="Resize Chat panel"
        width={width}
        renderedWidth={() => aside.current?.getBoundingClientRect().width ?? width}
        minWidth={SIDE_PANEL_MIN_WIDTH}
        maxWidth={maxWidth}
        onWidthChange={(next) => setWidth(Math.min(next, maxWidth()))}
        panelSide="right"
      />
      <aside
        ref={aside}
        aria-label="Chat panel"
        style={{ width, maxWidth: `calc(50% - ${SIDE_PANEL_HANDLE_WIDTH}px)` }}
        className="flex min-w-0 flex-col overflow-hidden rounded-island bg-island"
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || !busy) return
          event.preventDefault()
          stop()
        }}
      >
        <div className="flex h-panel-header shrink-0 items-center gap-0.5 pr-2 pl-4">
          <h2 className="type-panel-title flex-1 truncate">Chat</h2>
          <IconButton
            label="Generate Workspace Map"
            onClick={generateMap}
            disabled={status !== 'ready'}
          >
            <MapIcon className="size-4" aria-hidden />
          </IconButton>
          <IconButton label="Edit Workspace Map" onClick={editMap}>
            <FilePen className="size-4" aria-hidden />
          </IconButton>
          <IconButton label="New Chat (Shift Shift)" onClick={newChat}>
            <Plus className="size-4.5" aria-hidden />
          </IconButton>
          <IconButton label="Close Chat" onClick={close}>
            <X className="size-4.5" aria-hidden />
          </IconButton>
        </div>
        <Conversation>
          {items.length === 0 && status !== 'none' ? (
            <p className="type-description">
              {status === 'starting'
                ? 'Starting Claude…'
                : 'Ask Claude about the projects in this workspace.'}
            </p>
          ) : null}
          {items.map((item) => (
            <Item key={item.id} item={item} busy={busy} />
          ))}
          {busy ? (
            <p className="type-hint flex items-center gap-1.5">
              <Loader className="size-3.5 animate-spin" aria-hidden /> Working…
            </p>
          ) : null}
        </Conversation>
        {error === null ? null : (
          <p role="alert" className="type-hint shrink-0 px-4 pb-1 text-error">
            {error}
          </p>
        )}
        <Composer key={chatId ?? 'none'} />
      </aside>
    </>
  )
}
