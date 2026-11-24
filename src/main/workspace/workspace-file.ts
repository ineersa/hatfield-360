import type { TerminalLayout } from '../../shared/terminal-workspace-api'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { WorkspaceFolderKind } from '../../shared/workspace-api'
import { writeFileAtomic } from '../files/atomic-write'
import {
  EMPTY_WORKSPACE_DOCUMENT,
  parseWorkspaceDocument,
  serializeWorkspaceDocument
} from './workspace-document'
import { fromStoredFolderPath, toStoredFolderPath } from './workspace-folder-paths'

export const WORKSPACE_FILE_EXTENSION = '.hatfield-workspace'

/** The absolute path with the workspace extension, which save dialogs on Linux don't add. */
export function withWorkspaceExtension(file: string): string {
  return resolve(
    file.endsWith(WORKSPACE_FILE_EXTENSION) ? file : `${file}${WORKSPACE_FILE_EXTENSION}`
  )
}

/** A folder of an open workspace, by absolute path. */
export type WorkspaceEntry = { path: string; kind: WorkspaceFolderKind }

export type ReadWorkspaceFile =
  | { status: 'ok'; folders: WorkspaceEntry[]; terminals?: TerminalLayout }
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
  const folders = new Map<string, WorkspaceFolderKind>()
  for (const { path, kind } of parsed.document.folders) {
    const absolute = fromStoredFolderPath(path, file)
    if (!folders.has(absolute)) folders.set(absolute, kind)
  }
  return {
    status: 'ok',
    ...(parsed.document.terminals ? { terminals: parsed.document.terminals } : {}),
    folders: [...folders].map(([path, kind]) => ({ path, kind }))
  }
}

export function writeWorkspaceFile(
  file: string,
  folders: WorkspaceEntry[],
  terminals?: TerminalLayout
): Promise<void> {
  const document = {
    ...EMPTY_WORKSPACE_DOCUMENT,
    ...(terminals ? { terminals } : {}),
    folders: folders.map(({ path, kind }) => ({ path: toStoredFolderPath(path, file), kind }))
  }
  return writeFileAtomic(file, serializeWorkspaceDocument(document))
}
