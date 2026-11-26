import { isPlainObject } from '../../shared/plain-object'
import type {
  PermissionOption,
  SessionConfigOption,
  SessionUpdate,
  ToolCallContent
} from '@agentclientprotocol/sdk/unstable'
import {
  CHAT_CONFIG_IDS,
  type ChatConfigId,
  type ChatConfigOption,
  type ChatEventBody,
  type ChatPermissionOption,
  type ChatToolStatus
} from '../../shared/chat-agent-api'

/** Tool input or output beyond this is cut, so one huge read can't flood the page. */
const TOOL_TEXT_CAP = 20_000

const capped = (text: string): string =>
  text.length > TOOL_TEXT_CAP ? `${text.slice(0, TOOL_TEXT_CAP)}\n… (cut)` : text

const isConfigId = (id: string): id is ChatConfigId =>
  (CHAT_CONFIG_IDS as readonly string[]).includes(id)

/** The panel's settings (mode, model, effort) from the agent's options, flattening any groups. */
export function chatConfigOptions(
  options: readonly SessionConfigOption[] | null | undefined
): ChatConfigOption[] {
  const shown: ChatConfigOption[] = []
  for (const option of options ?? []) {
    if (option.type !== 'select' || !isConfigId(option.id)) continue
    const choices = option.options.flatMap((entry) => ('group' in entry ? entry.options : [entry]))
    shown.push({
      id: option.id,
      name: option.name,
      currentValue: option.currentValue,
      options: choices.map((choice) => ({
        value: choice.value,
        name: choice.name,
        description: choice.description ?? null
      }))
    })
  }
  return shown
}

/** What a tool was asked to do: a command as typed, a path, else its arguments as JSON. */
function toolInput(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined
  if (isPlainObject(raw)) {
    const fields = raw
    if (typeof fields.command === 'string') return capped(fields.command)
    if (Object.keys(fields).length === 0) return undefined
  }
  return capped(JSON.stringify(raw, null, 2))
}

function contentText(content: readonly ToolCallContent[]): string | undefined {
  const parts = content.flatMap((part) => {
    if (part.type === 'content' && part.content.type === 'text') return [part.content.text]
    if (part.type === 'diff') return [`Edited ${part.path}`]
    return []
  })
  return parts.length > 0 ? capped(parts.join('\n')) : undefined
}

const toolStatus = (status: string | null | undefined): ChatToolStatus | undefined =>
  status === 'pending' || status === 'in_progress' || status === 'completed' || status === 'failed'
    ? status
    : undefined

/** The chat events one ACP session update makes; updates the panel doesn't show make none. */
export function chatEventsFor(update: SessionUpdate): ChatEventBody[] {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
      return update.content.type === 'text' ? [{ kind: 'text', text: update.content.text }] : []
    case 'agent_thought_chunk':
      return update.content.type === 'text' ? [{ kind: 'thought', text: update.content.text }] : []
    case 'tool_call':
    case 'tool_call_update': {
      const title = update.title ?? undefined
      const status = toolStatus(update.status)
      const input = toolInput(update.rawInput)
      const output = update.content ? contentText(update.content) : undefined
      return [
        {
          kind: 'tool',
          toolCallId: update.toolCallId,
          ...(title ? { title } : {}),
          ...(status ? { status } : {}),
          ...(input === undefined ? {} : { input }),
          ...(output === undefined ? {} : { output })
        }
      ]
    }
    case 'config_option_update':
      return [{ kind: 'config', configOptions: chatConfigOptions(update.configOptions) }]
    default:
      return []
  }
}

const PERMISSION_KINDS = new Set<string>([
  'allow_once',
  'allow_always',
  'reject_once',
  'reject_always'
])

export function permissionOptions(options: readonly PermissionOption[]): ChatPermissionOption[] {
  return options.flatMap((option) =>
    PERMISSION_KINDS.has(option.kind)
      ? [
          {
            optionId: option.optionId,
            name: option.name,
            kind: option.kind
          }
        ]
      : []
  )
}
