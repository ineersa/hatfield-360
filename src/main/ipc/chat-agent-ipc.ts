import {
  CHAT_AGENT_CHANNELS,
  CHAT_CONFIG_IDS,
  CHAT_REFERENCE_CAP,
  type ChatConfigId
} from '../../shared/chat-agent-api'
import { chatAgentHost } from '../chat/chat-agent-host'
import { handleTrusted } from './trusted-ipc'

/** Prompts past this are refused; a chat message is typed, not a pasted file. */
const PROMPT_CAP = 100_000

function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[\w-]{1,128}$/.test(value)) throw new Error('Expected an id')
  return value
}

function configId(value: unknown): ChatConfigId {
  const found = CHAT_CONFIG_IDS.find((candidate) => candidate === value)
  if (!found) throw new Error('Unknown chat setting')
  return found
}

function paths(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > CHAT_REFERENCE_CAP) throw new Error('Expected paths')
  return value.map((path: unknown) => {
    if (typeof path !== 'string' || path === '' || path.length > 4096 || path.includes('\0'))
      throw new Error('Expected a path')
    return path
  })
}

export function registerChatAgentIpc(): void {
  handleTrusted(CHAT_AGENT_CHANNELS.start, (event, cwd) => {
    if (cwd !== null && typeof cwd !== 'string') throw new Error('Expected a folder or null')
    return chatAgentHost.start(event.sender, cwd)
  })
  handleTrusted(CHAT_AGENT_CHANNELS.prompt, (_event, chatId, text) => {
    if (typeof text !== 'string' || text.trim() === '' || text.length > PROMPT_CAP)
      throw new Error('Expected a message')
    chatAgentHost.chat(id(chatId)).prompt(text)
  })
  handleTrusted(CHAT_AGENT_CHANNELS.answerPermission, (_event, chatId, requestId, optionId) => {
    chatAgentHost
      .chat(id(chatId))
      .answerPermission(id(requestId), optionId === null ? null : id(optionId))
  })
  handleTrusted(CHAT_AGENT_CHANNELS.setConfig, (_event, chatId, config, value) => {
    if (typeof value !== 'string' || value.length > 128) throw new Error('Expected a value')
    return chatAgentHost.setConfig(id(chatId), configId(config), value)
  })
  handleTrusted(CHAT_AGENT_CHANNELS.stop, (_event, chatId) => {
    chatAgentHost.chat(id(chatId)).stop()
  })
  handleTrusted(CHAT_AGENT_CHANNELS.end, (_event, chatId) => {
    chatAgentHost.end(id(chatId))
  })
  handleTrusted(CHAT_AGENT_CHANNELS.generateMap, (_event, chatId) => {
    chatAgentHost.chat(id(chatId)).generateMap()
  })
  handleTrusted(CHAT_AGENT_CHANNELS.mapFile, () => chatAgentHost.mapFile())
  handleTrusted(CHAT_AGENT_CHANNELS.resolvePaths, (_event, chatId, requested) =>
    chatAgentHost.resolvePaths(id(chatId), paths(requested))
  )
}
