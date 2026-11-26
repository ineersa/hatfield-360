/** A session setting the agent offers (permission mode, model, effort) and its choices. */
export type ChatConfigOption = {
  id: ChatConfigId
  name: string
  currentValue: string
  options: { value: string; name: string; description: string | null }[]
}

/** The only agent settings the panel shows; others the agent offers are left alone. */
export const CHAT_CONFIG_IDS = ['mode', 'model', 'effort'] as const
export type ChatConfigId = (typeof CHAT_CONFIG_IDS)[number]

export type ChatToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

export type ChatPermissionOption = {
  optionId: string
  name: string
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always'
}

/** Why a turn ended, as the agent reports it, or `error` when it failed. */
export type ChatStopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'max_turn_requests'
  | 'refusal'
  | 'cancelled'
  | 'error'

/** What happens in a chat, in order; the renderer builds the conversation from these. */
export type ChatEventBody =
  | { kind: 'ready'; configOptions: ChatConfigOption[] }
  | { kind: 'text'; text: string }
  | { kind: 'thought'; text: string }
  /** A tool call appears, or changes: fields left out keep their last value. */
  | {
      kind: 'tool'
      toolCallId: string
      title?: string
      status?: ChatToolStatus
      input?: string
      output?: string
    }
  | {
      kind: 'permission'
      requestId: string
      toolCallId: string
      title: string
      options: ChatPermissionOption[]
    }
  | { kind: 'permission-settled'; requestId: string }
  | { kind: 'config'; configOptions: ChatConfigOption[] }
  | { kind: 'turn-end'; stopReason: ChatStopReason }
  /** The workspace map turn wrote its block into the map file. */
  | { kind: 'map-written'; file: string }
  | { kind: 'error'; message: string }
  /** The session is gone (ended, or the agent exited); New chat starts another. */
  | { kind: 'ended' }

export type ChatEvent = ChatEventBody & { chatId: string }

/** How many file references one reply may resolve at once; more stay text. */
export const CHAT_REFERENCE_CAP = 200

export const CHAT_AGENT_CHANNELS = {
  start: 'chat-agent:start',
  prompt: 'chat-agent:prompt',
  answerPermission: 'chat-agent:answer-permission',
  setConfig: 'chat-agent:set-config',
  stop: 'chat-agent:stop',
  end: 'chat-agent:end',
  generateMap: 'chat-agent:generate-map',
  mapFile: 'chat-agent:map-file',
  resolvePaths: 'chat-agent:resolve-paths',
  event: 'chat-agent:event'
} as const

export type ChatAgentApi = {
  /** Ends any running chat and starts a new session in `cwd` (a workspace folder or worktree). */
  startChat: (cwd: string | null) => Promise<{ chatId: string }>
  sendChatPrompt: (chatId: string, text: string) => Promise<void>
  /** `optionId` null cancels the request. */
  answerChatPermission: (
    chatId: string,
    requestId: string,
    optionId: string | null
  ) => Promise<void>
  setChatConfig: (chatId: string, configId: ChatConfigId, value: string) => Promise<void>
  /** Cancels the running turn and any command it runs; the chat continues with the next prompt. */
  stopChat: (chatId: string) => Promise<void>
  endChat: (chatId: string) => Promise<void>
  /** Runs the workspace map turn, shown in this chat, and writes its block into the map file. */
  generateWorkspaceMap: (chatId: string) => Promise<void>
  /** The workspace's map file, created empty when missing so it can be opened. */
  workspaceMapFile: () => Promise<string>
  /**
   * The files a reply's paths name, each resolved against the chat's folder and the workspace
   * folders, in order; null for one that isn't a file inside them.
   */
  resolveChatPaths: (chatId: string, paths: string[]) => Promise<(string | null)[]>
  subscribeChatEvents: (callback: (event: ChatEvent) => void) => () => void
}
