import type { TerminalLayout } from '../../shared/terminal-workspace-api'
import { parseTerminalLayout } from './terminal-layout'
import { isPlainObject } from '../../shared/plain-object'
import type { WorkspaceFolderKind } from '../../shared/workspace-api'

/** On-disk format of a `.hatfield-workspace` file. Bump the version when the shape changes. */
const WORKSPACE_DOCUMENT_VERSION = 1

export type WorkspaceDocument = {
  version: typeof WORKSPACE_DOCUMENT_VERSION
  terminals?: TerminalLayout
  folders: { path: string; kind: WorkspaceFolderKind }[]
  /** The chat's workspace map file, relative to the workspace file or absolute; a default when absent. */
  instructions?: string
}

export type ParsedWorkspaceDocument =
  | { status: 'ok'; document: WorkspaceDocument }
  | { status: 'corrupt'; reason: string }
  | { status: 'newer'; version: number }

export const EMPTY_WORKSPACE_DOCUMENT: WorkspaceDocument = {
  version: WORKSPACE_DOCUMENT_VERSION,
  folders: []
}

/** Parses workspace file contents; workspace files are user-editable, so nothing is trusted. */
export function parseWorkspaceDocument(text: string): ParsedWorkspaceDocument {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { status: 'corrupt', reason: 'not valid JSON' }
  }
  if (!isPlainObject(data)) return { status: 'corrupt', reason: 'not a JSON object' }
  const { version, folders } = data
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { status: 'corrupt', reason: 'missing or invalid version' }
  }
  if (version > WORKSPACE_DOCUMENT_VERSION) return { status: 'newer', version }
  if (!Array.isArray(folders)) return { status: 'corrupt', reason: 'folders is not a list' }
  const read = new Map<string, WorkspaceFolderKind>()
  for (const folder of folders) {
    if (!isPlainObject(folder) || typeof folder.path !== 'string' || folder.path === '') {
      return { status: 'corrupt', reason: 'a folder entry has no path' }
    }
    // Folders saved before kinds existed, or with a kind this version doesn't know, are projects.
    if (!read.has(folder.path))
      read.set(folder.path, folder.kind === 'folder' ? 'folder' : 'project')
  }
  const terminals = parseTerminalLayout(data.terminals, false, true)
  // A path the user broke is dropped, so the chat falls back to the default map file.
  const instructions =
    typeof data.instructions === 'string' && data.instructions.trim() !== ''
      ? data.instructions
      : undefined
  return {
    status: 'ok',
    document: {
      version: WORKSPACE_DOCUMENT_VERSION,
      ...(terminals ? { terminals } : {}),
      folders: [...read].map(([path, kind]) => ({ path, kind })),
      ...(instructions === undefined ? {} : { instructions })
    }
  }
}

export function serializeWorkspaceDocument(document: WorkspaceDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`
}
