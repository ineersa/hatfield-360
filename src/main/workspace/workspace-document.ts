/** On-disk format of a `.hatfield-workspace` file. Bump the version when the shape changes. */
const WORKSPACE_DOCUMENT_VERSION = 1

export type WorkspaceDocument = {
  version: typeof WORKSPACE_DOCUMENT_VERSION
  folders: { path: string }[]
}

export type ParsedWorkspaceDocument =
  | { status: 'ok'; document: WorkspaceDocument }
  | { status: 'corrupt'; reason: string }
  | { status: 'newer'; version: number }

export const EMPTY_WORKSPACE_DOCUMENT: WorkspaceDocument = {
  version: WORKSPACE_DOCUMENT_VERSION,
  folders: []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Parses workspace file contents; workspace files are user-editable, so nothing is trusted. */
export function parseWorkspaceDocument(text: string): ParsedWorkspaceDocument {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { status: 'corrupt', reason: 'not valid JSON' }
  }
  if (!isRecord(data)) return { status: 'corrupt', reason: 'not a JSON object' }
  const { version, folders } = data
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { status: 'corrupt', reason: 'missing or invalid version' }
  }
  if (version > WORKSPACE_DOCUMENT_VERSION) return { status: 'newer', version }
  if (!Array.isArray(folders)) return { status: 'corrupt', reason: 'folders is not a list' }
  const paths: string[] = []
  for (const folder of folders) {
    if (!isRecord(folder) || typeof folder.path !== 'string' || folder.path === '') {
      return { status: 'corrupt', reason: 'a folder entry has no path' }
    }
    paths.push(folder.path)
  }
  return {
    status: 'ok',
    document: {
      version: WORKSPACE_DOCUMENT_VERSION,
      folders: [...new Set(paths)].map((path) => ({ path }))
    }
  }
}

export function serializeWorkspaceDocument(document: WorkspaceDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`
}
