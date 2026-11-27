import { FilePen, Map as MapIcon, Plus, X } from 'lucide-react'
import { useLayoutEffect, useRef } from 'react'
import {
  Confirmation,
  ConfirmationAccepted,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRejected,
  ConfirmationTitle
} from '@/components/ai-elements/confirmation'
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton
} from '@/components/ai-elements/conversation'
import { Message, MessageContent } from '@/components/ai-elements/message'
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputProvider,
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools
} from '@/components/ai-elements/prompt-input'
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning'
import { Shimmer } from '@/components/ai-elements/shimmer'
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from '@/components/ai-elements/tool'
import type { ToolState } from '@/components/ai-elements/ui-parts'
import { SIDE_PANEL_HANDLE_WIDTH, PanelResizeHandle } from '@/components/shell/PanelResizeHandle'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/class-names'
import { cssFontFamily } from '@/lib/css-font-family'
import { appShortcutLabel } from '@/lib/keymap-match'
import { useChatStore } from '@/state/chat-store'
import { useKeymapStore } from '@/state/keymap-store'
import type { ChatItem } from '@/state/chat-transcript'
import { useSettingsStore } from '@/state/settings-store'
import { SIDE_PANEL_MIN_WIDTH, useShellLayoutStore } from '@/state/shell-layout-store'
import type { ChatConfigId, ChatToolStatus } from '../../../../shared/chat-agent-api'
import { ChatMarkdown } from './ChatMarkdown'

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
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className="text-muted-foreground"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

const TOOL_STATE: Record<ChatToolStatus, ToolState> = {
  pending: 'input-streaming',
  in_progress: 'input-available',
  completed: 'output-available',
  failed: 'output-error'
}

function Item({ item, live }: { item: ChatItem; live: boolean }): React.JSX.Element {
  const answer = useChatStore((state) => state.answerPermission)
  switch (item.kind) {
    case 'user':
      return (
        <Message from="user" aria-label="Your message">
          <MessageContent className="whitespace-pre-wrap">{item.text}</MessageContent>
        </Message>
      )
    case 'assistant':
      return (
        <Message from="assistant" aria-label="Claude's reply">
          <MessageContent>
            <ChatMarkdown text={item.text} streaming={live} />
          </MessageContent>
        </Message>
      )
    case 'thought':
      return (
        <Reasoning isStreaming={live}>
          <ReasoningTrigger />
          <ReasoningContent>{item.text}</ReasoningContent>
        </Reasoning>
      )
    case 'tool':
      return (
        <Tool role="group" aria-label={`Tool: ${item.title}`}>
          <ToolHeader
            type="dynamic-tool"
            toolName={item.title}
            title={item.title}
            state={TOOL_STATE[item.status]}
          />
          <ToolContent>
            {item.input === null ? null : <ToolInput input={item.input} />}
            <ToolOutput
              output={item.status === 'failed' ? undefined : item.output}
              errorText={item.status === 'failed' ? (item.output ?? 'Failed') : undefined}
            />
          </ToolContent>
        </Tool>
      )
    case 'permission': {
      const chosen = item.options.find((option) => option.name === item.answer)
      return (
        <Confirmation
          role="region"
          aria-label="Permission request"
          state={item.answer === null ? 'approval-requested' : 'approval-responded'}
          approval={
            item.answer === null
              ? { id: item.requestId }
              : { id: item.requestId, approved: chosen?.kind.startsWith('allow') ?? false }
          }
        >
          <ConfirmationTitle>
            Allow <span className="font-mono">{item.title}</span>?
          </ConfirmationTitle>
          <ConfirmationAccepted>
            <p className="type-hint">{item.answer}</p>
          </ConfirmationAccepted>
          <ConfirmationRejected>
            <p className="type-hint">{item.answer}</p>
          </ConfirmationRejected>
          <ConfirmationActions className="flex-wrap justify-start self-start">
            {item.options.map((option) => (
              <ConfirmationAction
                key={option.optionId}
                variant={option.kind.startsWith('allow') ? 'default' : 'outline'}
                onClick={() => answer(item.requestId, option.optionId, option.name)}
              >
                {option.name}
              </ConfirmationAction>
            ))}
          </ConfirmationActions>
        </Confirmation>
      )
    }
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

const PICKERS: { id: ChatConfigId; label: string }[] = [
  { id: 'mode', label: 'Mode' },
  { id: 'model', label: 'Model' },
  { id: 'effort', label: 'Effort' }
]

function ConfigPickers(): React.JSX.Element {
  const options = useChatStore((state) => state.configOptions)
  const setConfig = useChatStore((state) => state.setConfig)
  return (
    <PromptInputTools className="min-w-0 flex-1">
      {PICKERS.map(({ id, label }) => {
        const option = options.find((each) => each.id === id)
        if (!option) return null
        return (
          <PromptInputSelect
            key={id}
            value={option.currentValue}
            onValueChange={(value) => setConfig(id, value)}
          >
            <PromptInputSelectTrigger aria-label={label} title={label} className="min-w-0">
              <PromptInputSelectValue />
            </PromptInputSelectTrigger>
            <PromptInputSelectContent>
              {option.options.map((choice) => (
                <PromptInputSelectItem key={choice.value} value={choice.value}>
                  {choice.name}
                </PromptInputSelectItem>
              ))}
            </PromptInputSelectContent>
          </PromptInputSelect>
        )
      })}
    </PromptInputTools>
  )
}

function Composer(): React.JSX.Element {
  const status = useChatStore((state) => state.status)
  const send = useChatStore((state) => state.send)
  const stop = useChatStore((state) => state.stop)
  const busy = status === 'busy'
  return (
    <PromptInputProvider>
      <PromptInput
        className="shrink-0 p-2"
        onSubmit={({ text }) => {
          // Throwing keeps the text in the box: it wasn't sent.
          if (!send(text)) throw new Error('The message was not sent.')
        }}
      >
        <PromptInputBody>
          <PromptInputTextarea
            aria-label="Message"
            autoFocus
            placeholder="Ask about the workspace. @selection and @file refer to the editor."
            disabled={status === 'ended' || status === 'none'}
          />
        </PromptInputBody>
        <PromptInputFooter>
          <ConfigPickers />
          <PromptInputSubmit
            aria-label={busy ? 'Stop (Esc)' : 'Send (Enter)'}
            title={busy ? 'Stop (Esc)' : 'Send (Enter)'}
            status={busy ? 'streaming' : 'ready'}
            onStop={stop}
            disabled={!busy && status !== 'ready'}
          />
        </PromptInputFooter>
      </PromptInput>
    </PromptInputProvider>
  )
}

/** Claude in the workspace, on the right: opened with New Chat (Ctrl/Cmd+Shift+L), resized from its left edge. */
export function ChatPanel(): React.JSX.Element {
  const width = useShellLayoutStore((state) => state.chatWidth)
  const setWidth = useShellLayoutStore((state) => state.setChatWidth)
  const fontFamily = useSettingsStore((state) => state.values['editor.fontFamily'])
  const newChatShortcut = useKeymapStore((state) => appShortcutLabel(state.shell, 'new-chat'))
  const newChatLabel = newChatShortcut === '' ? 'New Chat' : `New Chat (${newChatShortcut})`
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
      <PanelResizeHandle
        label="Resize Chat panel"
        size={width}
        renderedSize={() => aside.current?.getBoundingClientRect().width ?? width}
        minSize={SIDE_PANEL_MIN_WIDTH}
        maxSize={maxWidth}
        onSizeChange={(next) => setWidth(Math.min(next, maxWidth()))}
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
          <IconButton label={newChatLabel} onClick={newChat}>
            <Plus className="size-4.5" aria-hidden />
          </IconButton>
          <IconButton label="Close Chat" onClick={close}>
            <X className="size-4.5" aria-hidden />
          </IconButton>
        </div>
        <Conversation aria-label="Conversation" className="min-h-0">
          <ConversationContent className="gap-3 px-4 py-2">
            {items.length === 0 && status !== 'none' ? (
              <ConversationEmptyState
                title={status === 'starting' ? 'Starting Claude…' : 'Ask Claude'}
                description="About the projects in this workspace."
              />
            ) : null}
            {items.map((item, index) => (
              <Item key={item.id} item={item} live={busy && index === items.length - 1} />
            ))}
            {busy ? <Shimmer className="type-hint">Working…</Shimmer> : null}
          </ConversationContent>
          <ConversationScrollButton aria-label="Scroll to the latest" />
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
