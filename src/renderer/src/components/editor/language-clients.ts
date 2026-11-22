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
}

const clients = new Map<string, Client>()
/** Which connection each open file uses. */
const fileConnections = new Map<string, string>()
/** Files whose tab is open, so a connection that arrives after the tab closed is dropped. */
const wanted = new Set<string>()
/** Servers that aren't installed are reported once each. */
const reportedMissing = new Set<string>()

window.desktop.subscribeLanguageServerMessages((id, message) =>
  clients.get(id)?.reader.receive(message)
)
window.desktop.subscribeLanguageServerStatus((status: LanguageServerStatus) => {
  const entry = clients.get(status.id)
  if (!entry) return
  if (status.state === 'failed' && status.message) {
    notify({
      severity: 'error',
      title: `The ${entry.connection.server} language server stopped`,
      body: status.message
    })
  }
  if (status.state === 'failed' || status.state === 'stopped') {
    clients.delete(status.id)
    entry.reader.closed()
  }
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
  const entry: Client = { connection, reader, client, files: new Set() }
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
  } catch (error) {
    console.error(`Connecting ${path} to its language server failed:`, error)
  }
}

/** The file's tab closed; its server stops once none of its files is open. */
export function detachLanguageServer(path: string): void {
  wanted.delete(path)
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
