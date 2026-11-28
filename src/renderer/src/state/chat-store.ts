import { create } from 'zustand'
import type { ChatConfigId, ChatConfigOption, ChatEvent } from '../../../shared/chat-agent-api'
import { expandPromptReferences } from '../../../shared/chat-references'
import { editorPromptContext } from './editor-selection'
import { useEditorTabStore } from './editor-tab-store'
import { useShellLayoutStore } from './shell-layout-store'
import {
  applyChatEvent,
  type ChatItem,
  withPermissionAnswer,
  withUserMessage
} from './chat-transcript'

/** Where the chat is: starting the agent, waiting for a prompt, running a turn, or gone. */
type ChatStatus = 'none' | 'starting' | 'ready' | 'busy' | 'ended'

type ChatState = {
  open: boolean
  chatId: string | null
  status: ChatStatus
  items: ChatItem[]
  configOptions: ChatConfigOption[]
  /** A problem with the last action (a prompt that couldn't expand, a failed start). */
  error: string | null
  /** Follows the chats' events from main; returns the unsubscribe. */
  connect: () => () => void
  /** New Chat (Ctrl/Cmd+Shift+L): opens the panel with a new chat, ending the one it had. */
  openNewChat: () => void
  /** Closes the panel, ending its chat. */
  close: () => void
  newChat: () => void
  /**
   * Opens the panel with a new chat in `cwd` (null: the workspace's) and sends `text`, written by
   * the app, once the agent is ready; ends the chat the panel had.
   */
  ask: (cwd: string | null, text: string) => void
  /** Sends the prompt; false when it can't go (nothing to expand a reference with, no chat). */
  send: (text: string) => boolean
  stop: () => void
  answerPermission: (requestId: string, optionId: string | null, label: string) => void
  setConfig: (configId: ChatConfigId, value: string) => void
  generateMap: () => void
  editMap: () => void
  /** Opens a reply's resolved file in the editor, at the line and column it gave. */
  openReference: (path: string, line: number | null, column: number | null) => void
}

/** A refused prompt or map request: its turn never started, so the chat takes the next one. */
const refused =
  (action: string, chatId: string) =>
  (error: unknown): void => {
    report(action)(error)
    const { chatId: current, status } = useChatStore.getState()
    if (current === chatId && status === 'busy') useChatStore.setState({ status: 'ready' })
  }

const report =
  (action: string) =>
  (error: unknown): void => {
    console.error(`${action} failed:`, error)
    useChatStore.setState({
      error: `${action} failed: ${error instanceof Error ? error.message : String(error)}`
    })
  }

/** Counts chat starts, so only the latest one's chat is kept. */
let starts = 0

/** The message a chat started by `ask` sends once ready, by chat id. */
const firstMessages = new Map<string, string>()

export const useChatStore = create<ChatState>((set, get) => ({
  open: false,
  chatId: null,
  status: 'none',
  items: [],
  configOptions: [],
  error: null,
  connect: () =>
    window.desktop.subscribeChatEvents((event: ChatEvent) => {
      const state = get()
      if (event.chatId !== state.chatId) return
      const items = applyChatEvent(state.items, event)
      switch (event.kind) {
        case 'ready': {
          set({ items, status: 'ready', configOptions: event.configOptions })
          const first = firstMessages.get(event.chatId)
          firstMessages.delete(event.chatId)
          if (first !== undefined) {
            set((current) => ({
              items: withUserMessage(current.items, first),
              status: 'busy',
              error: null
            }))
            window.desktop
              .sendChatPrompt(event.chatId, first)
              .catch(refused('Sending the message', event.chatId))
          }
          return
        }
        case 'config':
          set({ items, configOptions: event.configOptions })
          return
        case 'turn-end':
          set({ items, status: 'ready' })
          return
        case 'ended':
          set({ items, status: 'ended' })
          return
        default:
          set({ items })
      }
    }),
  openNewChat: () => {
    set({ open: true })
    get().newChat()
  },
  close: () => {
    starts++
    const { chatId } = get()
    set({ open: false, chatId: null, status: 'none', items: [], configOptions: [], error: null })
    if (chatId !== null) window.desktop.endChat(chatId).catch(() => undefined)
  },
  newChat: () => startChat(null, null),
  ask: (cwd, text) => {
    set({ open: true })
    startChat(cwd, text)
  },
  send: (text) => {
    const { chatId, status } = get()
    if (chatId === null || status !== 'ready' || text.trim() === '') return false
    const expanded = expandPromptReferences(text, editorPromptContext())
    if (!expanded.ok) {
      set({ error: expanded.error })
      return false
    }
    set((state) => ({ items: withUserMessage(state.items, text), status: 'busy', error: null }))
    window.desktop
      .sendChatPrompt(chatId, expanded.text)
      .catch(refused('Sending the message', chatId))
    return true
  },
  stop: () => {
    const { chatId } = get()
    if (chatId !== null) window.desktop.stopChat(chatId).catch(report('Stopping'))
  },
  answerPermission: (requestId, optionId, label) => {
    const { chatId } = get()
    if (chatId === null) return
    set((state) => ({ items: withPermissionAnswer(state.items, requestId, label) }))
    window.desktop
      .answerChatPermission(chatId, requestId, optionId)
      .catch(report('Answering the request'))
  },
  setConfig: (configId, value) => {
    const { chatId } = get()
    if (chatId !== null)
      window.desktop.setChatConfig(chatId, configId, value).catch(report('Changing the setting'))
  },
  generateMap: () => {
    const { chatId, status } = get()
    if (chatId === null || status !== 'ready') return
    set((state) => ({
      items: withUserMessage(state.items, 'Generate the workspace map'),
      status: 'busy',
      error: null
    }))
    window.desktop.generateWorkspaceMap(chatId).catch(refused('Generating the map', chatId))
  },
  editMap: () => {
    window.desktop
      .workspaceMapFile()
      .then((file) => {
        useShellLayoutStore.getState().showFiles()
        useEditorTabStore.getState().open(file)
      })
      .catch(report('Opening the map'))
  },
  openReference: (path, line, column) => {
    useShellLayoutStore.getState().showFiles()
    const start = column === null ? 0 : column - 1
    useEditorTabStore.getState().open(path, { line: line ?? 1, start, end: start, focus: true })
  }
}))

/** Starts a chat in `cwd` for the panel, ending the one it had; `first` is sent once it's ready. */
function startChat(cwd: string | null, first: string | null): void {
  const { chatId: previous } = useChatStore.getState()
  const start = ++starts
  useChatStore.setState({
    chatId: null,
    status: 'starting',
    items: [],
    configOptions: [],
    error: null
  })
  if (previous !== null) window.desktop.endChat(previous).catch(() => undefined)
  window.desktop
    .startChat(cwd)
    .then(({ chatId }) => {
      // Closed, or a newer chat asked for, while this one started.
      if (start === starts && useChatStore.getState().open) {
        if (first !== null) firstMessages.set(chatId, first)
        useChatStore.setState({ chatId })
      } else window.desktop.endChat(chatId).catch(() => undefined)
    })
    .catch((error: unknown) => {
      if (start !== starts) return
      useChatStore.setState({ status: 'none' })
      report('Starting the chat')(error)
    })
}
