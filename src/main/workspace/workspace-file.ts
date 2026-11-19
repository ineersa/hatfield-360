import { readFile } from 'node:fs/promises'
import { writeFileAtomic } from './atomic-write'
import {
  EMPTY_WORKSPACE_DOCUMENT,
  parseWorkspaceDocument,
  serializeWorkspaceDocument
} from './workspace-document'
import { fromStoredFolderPath, toStoredFolderPath } from './workspace-folder-paths'

export const WORKSPACE_FILE_EXTENSION = '.hatfield-workspace'

export type ReadWorkspaceFile =
  | { status: 'ok'; folders: string[] }
  | { status: 'missing' }
  | { status: 'corrupt'; reason: string }
  | { status: 'newer'; version: number }

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/** Reads a workspace file with its folders resolved to absolute paths. */
export async function readWorkspaceFile(file: string): Promise<ReadWorkspaceFile> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if (isMissingFileError(error)) return { status: 'missing' }
    throw error
  }
  const parsed = parseWorkspaceDocument(text)
  if (parsed.status !== 'ok') return parsed
  const folders = parsed.document.folders.map(({ path }) => fromStoredFolderPath(path, file))
  return { status: 'ok', folders: [...new Set(folders)] }
}

export function writeWorkspaceFile(file: string, folders: string[]): Promise<void> {
  const document = {
    ...EMPTY_WORKSPACE_DOCUMENT,
    folders: folders.map((folder) => ({ path: toStoredFolderPath(folder, file) }))
  }
  return writeFileAtomic(file, serializeWorkspaceDocument(document))
}
