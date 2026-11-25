import type { TerminalLayout } from '../../shared/terminal-workspace-api'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
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

/** The workspace map file a workspace uses when its file names none: `<name>.workspace.md` beside it. */
export const defaultInstructionsFile = (file: string): string =>
  join(dirname(file), `${basename(file, WORKSPACE_FILE_EXTENSION)}.workspace.md`)

/** A folder of an open workspace, by absolute path. */
export type WorkspaceEntry = { path: string; kind: WorkspaceFolderKind }

/** What a workspace file holds, with paths absolute. */
export type WorkspaceContents = {
  folders: WorkspaceEntry[]
  terminals?: TerminalLayout
  /** The workspace map file the user chose; absent means the default beside the workspace file. */
  instructions?: string
}

export type ReadWorkspaceFile =
  | ({ status: 'ok' } & WorkspaceContents)
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
  const { instructions } = parsed.document
  return {
    status: 'ok',
    ...(parsed.document.terminals ? { terminals: parsed.document.terminals } : {}),
    folders: [...folders].map(([path, kind]) => ({ path, kind })),
    ...(instructions === undefined
      ? {}
      : { instructions: fromStoredFolderPath(instructions, file) })
  }
}

export function writeWorkspaceFile(
  file: string,
  { folders, terminals, instructions }: WorkspaceContents
): Promise<void> {
  const document = {
    ...EMPTY_WORKSPACE_DOCUMENT,
    ...(terminals?.tabs.length ? { terminals } : {}),
    folders: folders.map(({ path, kind }) => ({ path: toStoredFolderPath(path, file), kind })),
    ...(instructions === undefined ? {} : { instructions: toStoredFolderPath(instructions, file) })
  }
  return writeFileAtomic(file, serializeWorkspaceDocument(document))
}
