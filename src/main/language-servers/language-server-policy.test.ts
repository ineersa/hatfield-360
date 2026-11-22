import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { clientMessageVerdict, serverRequestAnswer } from './language-server-policy'

const folder = join(tmpdir(), 'work', 'app')
const root = join(folder, 'packages', 'web')
const inside = pathToFileURL(join(folder, 'src', 'a.ts')).href
const outside = pathToFileURL(join(tmpdir(), 'work', 'secrets', 'key.ts')).href
const verdict = (message: unknown) => clientMessageVerdict(message, root, [folder], { fixed: 1 })

describe('clientMessageVerdict', () => {
  it('forwards document requests and responses inside the workspace folders', () => {
    const hover = {
      jsonrpc: '2.0',
      id: 3,
      method: 'textDocument/hover',
      params: { textDocument: { uri: inside }, position: { line: 0, character: 1 } }
    }
    expect(verdict(hover)).toEqual({ action: 'forward', message: hover })
    const response = { jsonrpc: '2.0', id: 7, result: null }
    expect(verdict(response)).toEqual({ action: 'forward', message: response })
  })

  it('drops any message naming a document outside the workspace folders, however deep', () => {
    expect(
      verdict({
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: { textDocument: { uri: outside, languageId: 'typescript', version: 1, text: '' } }
      }).action
    ).toBe('drop')
    expect(
      verdict({
        jsonrpc: '2.0',
        method: 'workspace/didChangeWatchedFiles',
        params: {
          changes: [
            { uri: inside, type: 2 },
            { uri: outside, type: 2 }
          ]
        }
      }).action
    ).toBe('drop')
    expect(
      verdict({
        jsonrpc: '2.0',
        id: 4,
        method: 'workspace/executeCommand',
        params: { command: 'open', arguments: [outside] }
      }).action
    ).toBe('drop')
    // A URI field on another scheme can't point the server anywhere either.
    expect(
      verdict({
        jsonrpc: '2.0',
        id: 5,
        method: 'textDocument/definition',
        params: {
          textDocument: { uri: 'https://example.com/a.ts' },
          position: { line: 0, character: 0 }
        }
      }).action
    ).toBe('drop')
  })

  it("drops methods that would change the server's settings or folders", () => {
    for (const method of [
      'workspace/didChangeConfiguration',
      'workspace/didChangeWorkspaceFolders'
    ]) {
      expect(verdict({ jsonrpc: '2.0', method, params: { settings: {} } }).action).toBe('drop')
    }
    expect(verdict({ id: 1, method: 'textDocument/hover' }).action).toBe('drop')
  })

  it("rewrites initialize with main's root and options, keeping only the page's capabilities", () => {
    const result = verdict({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        processId: 1,
        rootUri: outside,
        workspaceFolders: [{ uri: outside, name: 'x' }],
        initializationOptions: { tsserver: { path: '/tmp/evil' } },
        capabilities: { textDocument: { hover: {} } },
        locale: 'en'
      }
    })
    expect(result).toEqual({
      action: 'forward',
      message: {
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: {
          capabilities: { textDocument: { hover: {} } },
          locale: 'en',
          processId: process.pid,
          rootPath: root,
          rootUri: pathToFileURL(root).href,
          workspaceFolders: [{ uri: pathToFileURL(root).href, name: 'web' }],
          initializationOptions: { fixed: 1 }
        }
      }
    })
  })
})

describe('serverRequestAnswer', () => {
  const settings = { json: { validate: { enable: true } }, intelephense: { licenceKey: 'K' } }
  const ask = (method: string, params?: unknown) =>
    serverRequestAnswer({ jsonrpc: '2.0', id: 9, method, params }, root, settings)

  it('answers configuration requests from main settings, section by section', () => {
    expect(
      ask('workspace/configuration', {
        items: [
          { section: 'json.validate' },
          { section: 'intelephense.licenceKey' },
          { section: 'python' },
          {}
        ]
      })
    ).toEqual({ jsonrpc: '2.0', id: 9, result: [{ enable: true }, 'K', null, settings] })
  })

  it('answers the folder list with the root and refuses to fetch schemas', () => {
    expect(ask('workspace/workspaceFolders')).toEqual({
      jsonrpc: '2.0',
      id: 9,
      result: [{ uri: pathToFileURL(root).href, name: 'web' }]
    })
    expect(ask('vscode/content', ['https://json.schemastore.org/package'])).toMatchObject({
      id: 9,
      error: { code: -32803 }
    })
  })

  it('leaves other requests and notifications to the page', () => {
    expect(ask('workspace/applyEdit', { edit: {} })).toBeUndefined()
    expect(
      serverRequestAnswer({ jsonrpc: '2.0', method: 'workspace/configuration' }, root, settings)
    ).toBeUndefined()
  })
})
