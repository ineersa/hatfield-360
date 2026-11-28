import type { TerminalLayout } from '../../shared/terminal-workspace-api'
import { constants, copyFile, readFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
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

/**
 * The map file a workspace file names, when it's a `.md` file in the workspace file's folder or
 * below: main reads it into every chat and writes to it, so a shared workspace file can't point
 * main at a dotfile or a file elsewhere.
 */
function containedInstructionsFile(stored: string, file: string): string | null {
  const path = fromStoredFolderPath(stored, file)
  const inside = relative(dirname(file), path)
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) return null
  return extname(path).toLowerCase() === '.md' ? path : null
}

/** A folder of an open workspace, by absolute path. */
export type WorkspaceEntry = { path: string; kind: WorkspaceFolderKind; multiRepo?: true }

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

const hasCode = (error: unknown, code: string): boolean =>
  error instanceof Error && 'code' in error && error.code === code

const isMissingFileError = (error: unknown): boolean => hasCode(error, 'ENOENT')

/** Copies a workspace's map file for a new workspace, unless there's none or the target has one. */
export async function copyInstructionsFile(from: string, to: string): Promise<void> {
  try {
    await copyFile(from, to, constants.COPYFILE_EXCL)
  } catch (error) {
    if (!isMissingFileError(error) && !hasCode(error, 'EEXIST')) throw error
  }
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
  const folders = new Map<string, WorkspaceEntry>()
  for (const folder of parsed.document.folders) {
    const absolute = fromStoredFolderPath(folder.path, file)
    if (!folders.has(absolute)) folders.set(absolute, { ...folder, path: absolute })
  }
  const instructions =
    parsed.document.instructions === undefined
      ? null
      : containedInstructionsFile(parsed.document.instructions, file)
  return {
    status: 'ok',
    ...(parsed.document.terminals ? { terminals: parsed.document.terminals } : {}),
    folders: [...folders.values()],
    ...(instructions === null ? {} : { instructions })
  }
}

export function writeWorkspaceFile(
  file: string,
  { folders, terminals, instructions }: WorkspaceContents
): Promise<void> {
  const document = {
    ...EMPTY_WORKSPACE_DOCUMENT,
    ...(terminals?.tabs.length ? { terminals } : {}),
    folders: folders.map((folder) => ({ ...folder, path: toStoredFolderPath(folder.path, file) })),
    ...(instructions === undefined ? {} : { instructions: toStoredFolderPath(instructions, file) })
  }
  return writeFileAtomic(file, serializeWorkspaceDocument(document))
}
