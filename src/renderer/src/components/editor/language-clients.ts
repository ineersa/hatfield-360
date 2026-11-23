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
/** Which connection each open file uses. */
const fileConnections = new Map<string, string>()
/** Files whose tab is open, so a connection that arrives after the tab closed is dropped. */
const wanted = new Set<string>()
/** Each open file's language, to connect it again when its server restarts. */
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
  else useLanguageServerStore.getState().clearFiles(entry.files)
})

function startClient(connection: LanguageServerConnection): Client {
  const reader = new ConnectionReader()
  const root = Uri.file(connection.root)
  const client = new MonacoLanguageClient({
    name: `${connection.server} (${connection.root})`,
    clientOptions: {
      documentSelector: connection.languages.map((language) => ({
        language,
        scheme: 'file',
        pattern: { baseUri: root.toString(), pattern: '**/*' }
      })),
      workspaceFolder: { uri: root, name: connection.root, index: 0 },
      // Main owns the server's lifetime; a stopped server is reported, not restarted here.
      errorHandler: {
        error: () => ({ action: ErrorAction.Continue }),
        closed: () => ({ action: CloseAction.DoNotRestart })
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

/** Gives an open file its language server, starting one for its project when none runs. */
export async function attachLanguageServer(path: string, languageId: string): Promise<void> {
  if (wanted.has(path)) return
  wanted.add(path)
  try {
    const result = await window.desktop.connectLanguageServer(path, languageId)
    if (result.kind === 'missing' && !reportedMissing.has(result.server)) {
      reportedMissing.add(result.server)
      notify({
        severity: 'info',
        title: `No ${result.server} language server`,
        body: result.message
      })
    }
    if (result.kind !== 'connected' || !wanted.has(path)) return
    const entry = clients.get(result.connection.id) ?? startClient(result.connection)
    entry.files.add(path)
    fileConnections.set(path, result.connection.id)
    fileLanguages.set(path, languageId)
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
  if (entry.files.size > 0) return
  clients.delete(id)
  void entry.client
    .stop()
    .catch(() => undefined)
    .then(() => window.desktop.disconnectLanguageServer(id))
    .catch((error: unknown) => console.error('Stopping a language server failed:', error))
}
