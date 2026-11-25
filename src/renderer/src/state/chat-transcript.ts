import type {
  ChatEventBody,
  ChatPermissionOption,
  ChatToolStatus
} from '../../../shared/chat-agent-api'

/** One entry of the conversation as the panel shows it. */
export type ChatItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string }
  | { kind: 'thought'; id: string; text: string }
  | {
      kind: 'tool'
      id: string
      title: string
      status: ChatToolStatus
      input: string | null
      output: string | null
    }
  | {
      kind: 'permission'
      id: string
      requestId: string
      title: string
      options: ChatPermissionOption[]
      /** The chosen option's name, `Cancelled`, or null while it waits. */
      answer: string | null
    }
  | { kind: 'notice'; id: string; text: string; tone: 'info' | 'error' }

let counter = 0
const nextId = (): string => `item-${(counter += 1)}`

const append = (items: ChatItem[], item: ChatItem): ChatItem[] => [...items, item]

/** Adds streamed text to the reply or thought it continues, or starts a new one. */
function appendText(items: ChatItem[], kind: 'assistant' | 'thought', text: string): ChatItem[] {
  const last = items.at(-1)
  if (last?.kind === kind) return [...items.slice(0, -1), { ...last, text: last.text + text }]
  return append(items, { kind, id: nextId(), text })
}

const STOP_NOTICES: Partial<Record<string, string>> = {
  cancelled: 'Stopped.',
  max_tokens: 'The reply hit the length limit.',
  max_turn_requests: 'The turn hit its request limit.',
  refusal: 'Claude declined to answer.'
}

/** The conversation after one event from the chat's agent. */
export function applyChatEvent(items: ChatItem[], event: ChatEventBody): ChatItem[] {
  switch (event.kind) {
    case 'text':
      return appendText(items, 'assistant', event.text)
    case 'thought':
      return appendText(items, 'thought', event.text)
    case 'tool': {
      const index = items.findIndex((item) => item.kind === 'tool' && item.id === event.toolCallId)
      const known = items[index]
      if (known?.kind !== 'tool') {
        return append(items, {
          kind: 'tool',
          id: event.toolCallId,
          title: event.title ?? 'Tool',
          status: event.status ?? 'pending',
          input: event.input ?? null,
          output: event.output ?? null
        })
      }
      const changed: ChatItem = {
        ...known,
        title: event.title ?? known.title,
        status: event.status ?? known.status,
        input: event.input ?? known.input,
        output: event.output ?? known.output
      }
      return items.map((item, at) => (at === index ? changed : item))
    }
    case 'permission':
      return append(items, {
        kind: 'permission',
        id: nextId(),
        requestId: event.requestId,
        title: event.title,
        options: event.options,
        answer: null
      })
    case 'permission-settled':
      return items.map((item) =>
        item.kind === 'permission' && item.requestId === event.requestId && item.answer === null
          ? { ...item, answer: 'Cancelled' }
          : item
      )
    case 'turn-end': {
      const notice = STOP_NOTICES[event.stopReason]
      return notice
        ? append(items, { kind: 'notice', id: nextId(), text: notice, tone: 'info' })
        : items
    }
    case 'map-written':
      return append(items, {
        kind: 'notice',
        id: nextId(),
        text: `Wrote the workspace map to ${event.file}.`,
        tone: 'info'
      })
    case 'error':
      return append(items, { kind: 'notice', id: nextId(), text: event.message, tone: 'error' })
    case 'ended':
      return append(items, {
        kind: 'notice',
        id: nextId(),
        text: 'The chat ended. Start a new one to continue.',
        tone: 'info'
      })
  }
  // `ready` and `config` change the settings, not the conversation.
  return items
}

/** The conversation with the user's message added, as typed. */
export const withUserMessage = (items: ChatItem[], text: string): ChatItem[] =>
  append(items, { kind: 'user', id: nextId(), text })

/** The conversation with the user's answer recorded on its permission request. */
export const withPermissionAnswer = (
  items: ChatItem[],
  requestId: string,
  answer: string
): ChatItem[] =>
  items.map((item) =>
    item.kind === 'permission' && item.requestId === requestId ? { ...item, answer } : item
  )
