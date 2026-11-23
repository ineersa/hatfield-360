import { MonacoLanguageClient } from 'monaco-languageclient'
import { Uri } from 'vscode'
import {
  AbstractMessageReader,
  AbstractMessageWriter,
  CloseAction,
  type DataCallback,
  type Disposable,
  ErrorAction,
  type Message
} from 'vscode-languageclient/browser'
import { restartDelay } from '@/lib/restart-backoff'
import { useLanguageServerStore } from '@/state/language-server-store'
import { notify } from '@/state/notification-store'
import { useWorkspaceStore } from '@/state/workspace-store'
import { useWorktreeStore } from '@/state/worktree-store'
import { isPlainObject } from '../../../../shared/plain-object'
import type {
  LanguageServerConnection,
  LanguageServerStatus
} from '../../../../shared/language-server-api'

/** Messages main relays from one server connection. */
class ConnectionReader extends AbstractMessageReader {
  private callback: DataCallback | undefined

  listen(callback: DataCallback): Disposable {
    this.callback = callback
    return { dispose: () => (this.callback = undefined) }
  }

  receive(message: unknown): void {
    if (isPlainObject(message) && typeof message['jsonrpc'] === 'string') {
      this.callback?.({ ...message, jsonrpc: message['jsonrpc'] })
    }
  }

  closed(): void {
    this.fireClose()
  }
}

class ConnectionWriter extends AbstractMessageWriter {
  constructor(private readonly id: string) {
    super()
  }

  async write(message: Message): Promise<void> {
    try {
      await window.desktop.sendLanguageServerMessage(this.id, message)
    } catch (error) {
      this.fireError([error instanceof Error ? error : new Error(String(error)), message, 1])
    }
  }

  end(): void {}
}

type Client = {
  connection: LanguageServerConnection
  reader: ConnectionReader
  client: MonacoLanguageClient
  files: Set<string>
  state: 'starting' | 'ready'
}

const clients = new Map<string, Client>()
/** Connections given back to main, whose client waits for main to report the server gone. */
const closing = new Map<string, Client>()
/** Connections the page gave back; one main hands out again is already stopping, so it is asked anew. */
const released = new Set<string>()
/** Which connection each open file uses. */
const fileConnections = new Map<string, string>()
/** Files whose tab is open and that have or are getting a server, so a late connection to a closed tab is dropped. */
const wanted = new Set<string>()
/** Each open file's language, to connect it again when its server restarts or its folder comes back. */
const fileLanguages = new Map<string, string>()
/** Servers that aren't installed are reported once each. */
const reportedMissing = new Set<string>()
/** When each server (per project root) crashed, oldest first. */
const crashes = new Map<string, number[]>()

const showStatus = (
  paths: Iterable<string>,
  server: string,
  state: 'starting' | 'ready' | 'restarting' | 'failed'
) => useLanguageServerStore.getState().setFiles(paths, { server, state })

/** A crashed server is started again for its open files after a pause, until it crashes too often. */
function restartAfterCrash(entry: Client, log: string | undefined): void {
  const { server, root } = entry.connection
  const files = [...entry.files]
  const key = `${server}\0${root}`
  const earlier = crashes.get(key) ?? []
  const now = Date.now()
  const delay = restartDelay(earlier, now)
  crashes.set(key, [...earlier, now])
  if (delay === null) {
    showStatus(files, server, 'failed')
    notify({
      severity: 'error',
      title: `The ${server} language server keeps stopping`,
      body: [log, 'It is no longer restarted; close and reopen a file to start it again.']
        .filter(Boolean)
        .join('\n')
    })
    return
  }
  showStatus(files, server, 'restarting')
  setTimeout(() => {
    for (const path of files) {
      const language = fileLanguages.get(path)
      // Closed while it waited, or already connected again.
      if (!wanted.has(path) || language === undefined || fileConnections.has(path)) continue
      wanted.delete(path)
      void attachLanguageServer(path, language)
    }
  }, delay)
}

window.desktop.subscribeLanguageServerMessages((id, message) =>
  clients.get(id)?.reader.receive(message)
)
window.desktop.subscribeLanguageServerStatus((status: LanguageServerStatus) => {
  const done = closing.get(status.id)
  if (done && (status.state === 'failed' || status.state === 'stopped')) {
    closing.delete(status.id)
    done.reader.closed()
    return
  }
  const entry = clients.get(status.id)
  if (!entry) return
  const { server } = entry.connection
  if (status.state === 'starting' || status.state === 'ready') {
    entry.state = status.state
    showStatus(entry.files, server, status.state)
    return
  }
  if (status.state !== 'failed' && status.state !== 'stopped') return
  clients.delete(status.id)
  for (const path of entry.files) fileConnections.delete(path)
  entry.reader.closed()
  if (status.state === 'failed') restartAfterCrash(entry, status.message)
  else {
    // Main stopped it: its folder left the workspace. The tabs connect again if it comes back.
    for (const path of entry.files) wanted.delete(path)
    useLanguageServerStore.getState().clearFiles(entry.files)
  }
})

/** Open files left without a server because their folder left the workspace try again. */
function reattachOutside(): void {
  for (const [path, language] of fileLanguages) {
    if (!wanted.has(path)) void attachLanguageServer(path, language)
  }
}
useWorkspaceStore.subscribe((state, previous) => {
  if (state.workspace !== previous.workspace) reattachOutside()
})
useWorktreeStore.subscribe((state, previous) => {
  if (state.projects !== previous.projects) reattachOutside()
})

function startClient(connection: LanguageServerConnection): Client {
  const reader = new ConnectionReader()
  const root = Uri.file(connection.root)
  const client = new MonacoLanguageClient({
    name: `${connection.server} (${connection.root})`,
    clientOptions: {
      documentSelector: [connection.root, ...connection.libraries].flatMap((folder) =>
        connection.languages.map((language) => ({
          language,
          scheme: 'file',
          pattern: { baseUri: Uri.file(folder).toString(), pattern: '**/*' }
        }))
      ),
      workspaceFolder: { uri: root, name: connection.root, index: 0 },
      // Main owns the server's lifetime and reports how it ended; the client never restarts it.
      errorHandler: {
        error: () => ({ action: ErrorAction.Continue }),
        closed: () => ({ action: CloseAction.DoNotRestart, handled: true })
      }
    },
    messageTransports: { reader, writer: new ConnectionWriter(connection.id) }
  })
  const entry: Client = { connection, reader, client, files: new Set(), state: 'starting' }
  clients.set(connection.id, entry)
  client
    .start()
    .catch((error: unknown) => console.error(`Starting ${connection.server} failed:`, error))
  return entry
}

/**
 * Gives the connection back to main, which shuts its server down. The client stays until main says
 * the server is gone: it must not stop the server itself, and nothing may reuse the connection.
 */
function release(id: string): void {
  released.add(id)
  const entry = clients.get(id)
  if (entry) {
    clients.delete(id)
    closing.set(id, entry)
  }
  window.desktop.disconnectLanguageServer(id).catch((error: unknown) => {
    console.error('Stopping a language server failed:', error)
    closing.delete(id)
    entry?.reader.closed()
  })
}

/** Main's connection for the file, asked again while it names one the page already gave back. */
async function connect(path: string, languageId: string) {
  for (;;) {
    const result = await window.desktop.connectLanguageServer(path, languageId)
    if (result.kind !== 'connected' || !released.has(result.connection.id)) return result
  }
}

/** Gives an open file its language server, starting one for its project when none runs. */
export async function attachLanguageServer(path: string, languageId: string): Promise<void> {
  if (wanted.has(path)) return
  wanted.add(path)
  fileLanguages.set(path, languageId)
  try {
    const result = await connect(path, languageId)
    if (result.kind === 'outside') {
      wanted.delete(path)
      return
    }
    if (result.kind === 'missing' && !reportedMissing.has(result.server)) {
      reportedMissing.add(result.server)
      notify({
        severity: 'info',
        title: `No ${result.server} language server`,
        body: result.message
      })
    }
    if (result.kind !== 'connected') return
    const { id } = result.connection
    if (!wanted.has(path)) {
      // The tab closed while main started the server; it is given back unless another file uses it.
      if (!clients.get(id)?.files.size) release(id)
      return
    }
    const entry = clients.get(result.connection.id) ?? startClient(result.connection)
    entry.files.add(path)
    fileConnections.set(path, result.connection.id)
    showStatus([path], entry.connection.server, entry.state)
  } catch (error) {
    console.error(`Connecting ${path} to its language server failed:`, error)
  }
}

/** The file's tab closed; its server stops once none of its files is open. */
export function detachLanguageServer(path: string): void {
  wanted.delete(path)
  fileLanguages.delete(path)
  useLanguageServerStore.getState().clearFiles([path])
  const id = fileConnections.get(path)
  if (id === undefined) return
  fileConnections.delete(path)
  const entry = clients.get(id)
  if (!entry) return
  entry.files.delete(path)
  if (entry.files.size === 0) release(id)
}
