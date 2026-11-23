import { fileURLToPath, pathToFileURL } from 'node:url'
import { basename } from 'node:path'
import { isPlainObject } from '../../shared/plain-object'
import { resolveTargetInsideRoots } from '../files/path-containment'

type JsonObject = Record<string, unknown>

/** What main does with a message the page sent for its server. */
export type ClientVerdict =
  | { action: 'forward'; message: JsonObject }
  | { action: 'drop'; reason: string }

/**
 * Requests and notifications a page may send; anything else could reconfigure or redirect the
 * server. Shutting it down is main's alone, so `shutdown` and `exit` are not among them.
 */
const CLIENT_METHODS: (string | RegExp)[] = [
  'initialize',
  'initialized',
  '$/cancelRequest',
  '$/setTrace',
  /^textDocument\//,
  /^notebookDocument\//,
  /^callHierarchy\//,
  /^typeHierarchy\//,
  /\/resolve$/,
  'workspace/symbol',
  'workspace/executeCommand',
  'workspace/diagnostic',
  'workspace/didChangeWatchedFiles',
  'workspace/willCreateFiles',
  'workspace/didCreateFiles',
  'workspace/willRenameFiles',
  'workspace/didRenameFiles',
  'workspace/willDeleteFiles',
  'workspace/didDeleteFiles',
  'window/workDoneProgress/cancel'
]

const allowedMethod = (method: string): boolean =>
  CLIENT_METHODS.some((allowed) =>
    typeof allowed === 'string' ? allowed === method : allowed.test(method)
  )

const URI_SCHEME = /^[a-z][a-z0-9+.-]*:/i

/** Every string in `value` that names a document: a `...uri`/`...Uri` field, or any `file:` URL. */
function uris(value: unknown, key = ''): string[] {
  if (typeof value === 'string') {
    const named = /uri$/i.test(key) && URI_SCHEME.test(value)
    return named || value.startsWith('file:') ? [value] : []
  }
  if (Array.isArray(value)) return value.flatMap((each) => uris(each, key))
  if (isPlainObject(value)) return Object.entries(value).flatMap(([name, each]) => uris(each, name))
  return []
}

/** Whether a `file:` URI leads inside `roots` once links are followed (a new file by its folder). */
async function fileUriInside(uri: string, roots: string[]): Promise<boolean> {
  if (!uri.startsWith('file:')) return false
  let path: string
  try {
    path = fileURLToPath(uri)
  } catch {
    return false
  }
  return (await resolveTargetInsideRoots(path, roots)) !== null
}

const rootUri = (root: string): string => pathToFileURL(root).href

/**
 * The page's own `initialize`, with everything that decides what the server runs or reads set by
 * main: the root, workspace folders, process id and initialization options.
 */
function initializeParams(params: unknown, root: string, options: unknown): JsonObject {
  const fromPage = isPlainObject(params) ? params : {}
  return {
    capabilities: isPlainObject(fromPage['capabilities']) ? fromPage['capabilities'] : {},
    ...(isPlainObject(fromPage['clientInfo']) ? { clientInfo: fromPage['clientInfo'] } : {}),
    ...(typeof fromPage['locale'] === 'string' ? { locale: fromPage['locale'] } : {}),
    processId: process.pid,
    rootPath: root,
    rootUri: rootUri(root),
    workspaceFolders: [{ uri: rootUri(root), name: basename(root) }],
    initializationOptions: options ?? {}
  }
}

/**
 * Checks a message from the page against the policy: its documents must be inside `folders` (the
 * workspace's). `initialize` is rewritten for the server's `root`, not checked.
 */
export async function clientMessageVerdict(
  message: unknown,
  root: string,
  folders: string[],
  initializationOptions: unknown
): Promise<ClientVerdict> {
  if (!isPlainObject(message) || message['jsonrpc'] !== '2.0') {
    return { action: 'drop', reason: 'not a JSON-RPC message' }
  }
  const method = message['method']
  if (method === undefined) {
    // A response to one of the server's requests; it carries no method to check.
    return 'id' in message
      ? { action: 'forward', message }
      : { action: 'drop', reason: 'neither a request nor a response' }
  }
  if (typeof method !== 'string' || !allowedMethod(method)) {
    return {
      action: 'drop',
      reason: typeof method === 'string' ? `${method} isn't allowed` : 'its method is not a name'
    }
  }
  if (method === 'initialize') {
    return {
      action: 'forward',
      message: {
        ...message,
        params: initializeParams(message['params'], root, initializationOptions)
      }
    }
  }
  const named = uris(message['params'])
  const inside = await Promise.all(named.map((uri) => fileUriInside(uri, folders)))
  const outside = named.find((_, index) => !inside[index])
  return outside === undefined
    ? { action: 'forward', message }
    : { action: 'drop', reason: `${outside} is outside the workspace folders` }
}

/** The value at a dotted `section` of `settings` (the whole object for no section), or null. */
function settingsSection(settings: JsonObject, section: unknown): unknown {
  if (typeof section !== 'string' || section === '') return settings
  let value: unknown = settings
  for (const key of section.split('.')) {
    if (!isPlainObject(value) || !Object.hasOwn(value, key)) return null
    value = value[key]
  }
  return value
}

/**
 * Main's answer to a server request it handles itself, so the page can't choose the server's
 * settings or folders; undefined for requests that go on to the page.
 */
export function serverRequestAnswer(
  message: JsonObject,
  root: string,
  settings: JsonObject
): JsonObject | undefined {
  const { id, method, params } = message
  if (id === undefined || typeof method !== 'string') return undefined
  const reply = (result: unknown): JsonObject => ({ jsonrpc: '2.0', id, result })
  switch (method) {
    case 'workspace/configuration': {
      const items = isPlainObject(params) && Array.isArray(params['items']) ? params['items'] : []
      return reply(
        items.map((item: unknown) =>
          settingsSection(settings, isPlainObject(item) ? item['section'] : undefined)
        )
      )
    }
    case 'workspace/workspaceFolders':
      return reply([{ uri: rootUri(root), name: basename(root) }])
    // The JSON server asks for schemas it doesn't fetch itself; remote ones are never downloaded.
    case 'vscode/content':
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32803, message: 'Schemas are not downloaded.' }
      }
    default:
      return undefined
  }
}
