/** A page's link to a language server process: one per server and project root, shared by its files. */
export type LanguageServerConnection = {
  id: string
  /** The server's name from main's configuration, such as `TypeScript`. */
  server: string
  /** The project folder the server was started in. */
  root: string
  /** The language ids whose files in `root` this connection serves. */
  languages: string[]
  /** Folders of the language's own sources outside any project, whose files it serves read-only. */
  libraries: string[]
}

/** What opening a file finds: its server, no server for its language, or a server that isn't installed. */
export type LanguageServerConnectResult =
  | { kind: 'connected'; connection: LanguageServerConnection }
  | { kind: 'none' }
  | { kind: 'missing'; server: string; message: string }

export type LanguageServerState = 'starting' | 'ready' | 'restarting' | 'failed' | 'stopped'

export type LanguageServerStatus = {
  id: string
  state: LanguageServerState
  /** Why it failed, with the end of the server's log. */
  message?: string
}

export const LANGUAGE_SERVER_CHANNELS = {
  connect: 'language-server:connect',
  send: 'language-server:send',
  disconnect: 'language-server:disconnect',
  message: 'language-server:message',
  status: 'language-server:status'
} as const

export type LanguageServerApi = {
  /** The language server for an open file, started if needed (one per server and project root). */
  connectLanguageServer: (path: string, languageId: string) => Promise<LanguageServerConnectResult>
  /** One JSON-RPC message for the server; main drops what its policy doesn't allow. */
  sendLanguageServerMessage: (id: string, message: unknown) => Promise<void>
  /** The page is done with the connection; the server stops once no page uses it. */
  disconnectLanguageServer: (id: string) => Promise<void>
  subscribeLanguageServerMessages: (callback: (id: string, message: unknown) => void) => () => void
  subscribeLanguageServerStatus: (callback: (status: LanguageServerStatus) => void) => () => void
}
