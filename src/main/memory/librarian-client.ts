import { isPlainObject } from '../../shared/plain-object'

/** Where Librarian's MCP endpoint is, from Settings. */
export type LibrarianEndpoint = { url: string; timeoutMs: number; token: string | null }

/** Librarian answered, but with `ok: false` or a tool error. */
class LibrarianToolError extends Error {
  constructor(
    readonly code: string | null,
    message: string
  ) {
    super(message)
  }
}

const PROTOCOL_VERSION = '2025-06-18'
// Librarian caps a payload at 1 MiB and repeats it as text beside structuredContent.
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024

type Connection = { sessionId: string | null; protocolVersion: string }

class SessionExpired extends Error {}

const connections = new Map<string, Promise<Connection>>()
let nextId = 1

async function boundedText(response: Response): Promise<string> {
  const reader: ReadableStreamDefaultReader<unknown> | undefined = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!(value instanceof Uint8Array)) throw new Error('Librarian sent an unreadable response.')
    size += value.byteLength
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new Error('Librarian sent a response larger than 8 MiB.')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** The JSON-RPC response with `id` from a JSON body or a server-sent event stream. */
function rpcMessage(text: string, eventStream: boolean, id: number): unknown {
  if (!eventStream) return JSON.parse(text) as unknown
  for (const event of text.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
    if (!data) continue
    const message: unknown = JSON.parse(data)
    if (isPlainObject(message) && message.id === id) return message
  }
  throw new Error('Librarian closed the stream without answering.')
}

async function post(
  endpoint: LibrarianEndpoint,
  project: string,
  connection: Connection | null,
  body: Record<string, unknown>,
  signal: AbortSignal
): Promise<{ response: Response; message: unknown }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'X-Librarian-Project': project
  }
  if (endpoint.token) headers.Authorization = `Bearer ${endpoint.token}`
  if (connection) {
    headers['MCP-Protocol-Version'] = connection.protocolVersion
    if (connection.sessionId) headers['Mcp-Session-Id'] = connection.sessionId
  }
  const response = await fetch(endpoint.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', ...body }),
    redirect: 'error',
    signal
  })
  if (response.status === 404 && connection?.sessionId) throw new SessionExpired()
  if (response.status === 401 || response.status === 403)
    throw new Error(`Librarian refused the request (HTTP ${response.status}); check its token.`)
  if (!response.ok) throw new Error(`Librarian answered HTTP ${response.status}.`)
  if (typeof body.id !== 'number' || response.status === 202) {
    await response.body?.cancel()
    return { response, message: null }
  }
  const text = await boundedText(response)
  const eventStream = (response.headers.get('content-type') ?? '').includes('text/event-stream')
  return { response, message: rpcMessage(text, eventStream, body.id) }
}

function rpcResult(message: unknown): Record<string, unknown> {
  if (!isPlainObject(message)) throw new Error('Librarian sent an unreadable response.')
  if (isPlainObject(message.error)) {
    const detail = typeof message.error.message === 'string' ? message.error.message : 'unknown'
    throw new Error(`Librarian error: ${detail}`)
  }
  if (!isPlainObject(message.result)) throw new Error('Librarian sent an unreadable response.')
  return message.result
}

async function request(
  endpoint: LibrarianEndpoint,
  project: string,
  connection: Connection | null,
  method: string,
  params: Record<string, unknown>,
  signal: AbortSignal
): Promise<{ response: Response; result: Record<string, unknown> }> {
  const id = nextId++
  const { response, message } = await post(
    endpoint,
    project,
    connection,
    { id, method, params },
    signal
  )
  return { response, result: rpcResult(message) }
}

function toolPayload(result: Record<string, unknown>): Record<string, unknown> {
  const payload = result.structuredContent
  if (!isPlainObject(payload)) throw new Error('Librarian did not return structured content.')
  if (result.isError === true || payload.ok === false) {
    const code = typeof payload.error === 'string' ? payload.error : null
    const message =
      typeof payload.message === 'string' && payload.message
        ? payload.message
        : `Librarian could not do that${code ? ` (${code})` : ''}.`
    throw new LibrarianToolError(code, message)
  }
  return payload
}

async function connect(
  endpoint: LibrarianEndpoint,
  project: string,
  signal: AbortSignal
): Promise<Connection> {
  const { response, result } = await request(
    endpoint,
    project,
    null,
    'initialize',
    {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'hatfield-360', version: '1' }
    },
    signal
  )
  const connection: Connection = {
    sessionId: response.headers.get('mcp-session-id'),
    protocolVersion:
      typeof result.protocolVersion === 'string' ? result.protocolVersion : PROTOCOL_VERSION
  }
  await post(endpoint, project, connection, { method: 'notifications/initialized' }, signal)
  // Registers the project once per connection; it does not wait for indexing, as Librarian asks.
  const registered = await request(
    endpoint,
    project,
    connection,
    'tools/call',
    { name: 'ensure_project', arguments: {} },
    signal
  )
  toolPayload(registered.result)
  return connection
}

function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  const reason = (): Error =>
    signal.reason instanceof Error ? signal.reason : new Error('The request was cancelled.')
  if (signal.aborted) return Promise.reject(reason())
  return new Promise((resolve, reject) => {
    const onAbort = (): void => reject(reason())
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

function failureMessage(error: unknown, endpoint: LibrarianEndpoint, timedOut: boolean): string {
  if (timedOut) return `Librarian didn't answer within ${Math.round(endpoint.timeoutMs / 1000)} s.`
  if (error instanceof LibrarianToolError) return error.message
  const cause: unknown = error instanceof Error ? error.cause : null
  // Node's fetch reports the socket error, such as ECONNREFUSED, as the cause of "fetch failed".
  const code =
    cause instanceof Error && 'code' in cause && typeof cause.code === 'string' ? cause.code : null
  const host = URL.canParse(endpoint.url) ? new URL(endpoint.url).host : endpoint.url
  if (code === 'ECONNREFUSED') return `Librarian didn't answer: connection refused (${host}).`
  if (code === 'ENOTFOUND') return `Librarian's host wasn't found (${host}).`
  if (error instanceof SyntaxError) return 'Librarian sent a response that is not valid JSON.'
  if (cause instanceof Error) return `Librarian didn't answer: ${cause.message} (${host}).`
  return error instanceof Error ? error.message : String(error)
}

/**
 * Calls one Librarian MCP tool for `project` (the checkout root it indexes), reusing that
 * project's MCP session. Rejects with a readable message; `signal` cancels without one.
 */
export async function callLibrarianTool(
  endpoint: LibrarianEndpoint,
  project: string,
  tool: string,
  args: Record<string, unknown>,
  signal: AbortSignal
): Promise<Record<string, unknown>> {
  const timeout = AbortSignal.timeout(endpoint.timeoutMs)
  const combined = AbortSignal.any([signal, timeout])
  const key = JSON.stringify([endpoint.url, endpoint.token, project])
  try {
    for (let attempt = 0; ; attempt++) {
      let pending = connections.get(key)
      if (!pending) {
        // Shared by concurrent calls, so one caller's cancellation must not abort it.
        const connecting = connect(endpoint, project, AbortSignal.timeout(endpoint.timeoutMs))
        connections.set(key, connecting)
        connecting.catch(() => {
          if (connections.get(key) === connecting) connections.delete(key)
        })
        pending = connecting
      }
      try {
        const connection = await untilAborted(pending, combined)
        const { result } = await request(
          endpoint,
          project,
          connection,
          'tools/call',
          { name: tool, arguments: args },
          combined
        )
        return toolPayload(result)
      } catch (error) {
        if (
          !signal.aborted &&
          !(error instanceof LibrarianToolError) &&
          connections.get(key) === pending
        )
          connections.delete(key)
        if (error instanceof SessionExpired && attempt === 0) continue
        throw error
      }
    }
  } catch (error) {
    if (signal.aborted) throw error
    throw new Error(failureMessage(error, endpoint, timeout.aborted), { cause: error })
  }
}
