import { Emitter } from '@codingame/monaco-vscode-api/vscode/vs/base/common/event'
import {
  Disposable,
  type IDisposable
} from '@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle'
import type { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri'
import {
  FileSystemProviderCapabilities,
  FileSystemProviderError,
  FileSystemProviderErrorCode,
  FileType,
  type IFileChange,
  type IFileSystemProviderWithFileReadWriteCapability,
  type IStat
} from '@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files'
import type { EditorFile } from '../../../../shared/editor-api'

const encoder = new TextEncoder()

const fileError = (message: string, code: FileSystemProviderErrorCode): FileSystemProviderError =>
  FileSystemProviderError.create(message, code)

/**
 * VS Code's view of `file:` URIs: files read through main's guarded editor access, read-only. The
 * editor's text models come from VS Code's text file service through it, so a tab, a peek and a
 * reference list share one model per file; saving and reloading stay with the editor tabs.
 */
export class WorkspaceFileSystem implements IFileSystemProviderWithFileReadWriteCapability {
  readonly capabilities: FileSystemProviderCapabilities =
    FileSystemProviderCapabilities.FileReadWrite | FileSystemProviderCapabilities.PathCaseSensitive
  readonly onDidChangeCapabilities = new Emitter<void>().event
  readonly onDidChangeFile = new Emitter<readonly IFileChange[]>().event
  /** Files a tab has just read, handed to VS Code instead of reading them again. */
  private readonly primed = new Map<string, EditorFile>()

  /** @param holds Whether a tab holds the file: main keeps watching it after VS Code's read. */
  constructor(private readonly holds: (path: string) => boolean) {}

  /**
   * Runs `open` with VS Code's reads of `path` answered by `file`, which a tab read a moment ago.
   * A model VS Code already has isn't read at all, so the file is never kept past `open`.
   */
  async withPrimed<T>(path: string, file: EditorFile, open: () => Promise<T>): Promise<T> {
    this.primed.set(path, file)
    try {
      return await open()
    } finally {
      this.primed.delete(path)
    }
  }

  private async editorFile(uri: URI): Promise<EditorFile> {
    const path = uri.fsPath
    const primed = this.primed.get(path)
    if (primed) return primed
    const file = await window.desktop.readTextFile(path)
    // A file read only for a peek or a definition isn't held for any tab.
    if (!this.holds(path)) await window.desktop.releaseTextFile(path)
    return file
  }

  async stat(uri: URI): Promise<IStat> {
    const file = await this.editorFile(uri)
    if (file.kind === 'missing')
      throw fileError(`${uri.fsPath} not found`, FileSystemProviderErrorCode.FileNotFound)
    const size = file.kind === 'text' ? encoder.encode(file.text).byteLength : file.size
    return { type: FileType.File, ctime: 0, mtime: 0, size }
  }

  async readFile(uri: URI): Promise<Uint8Array> {
    const file = await this.editorFile(uri)
    if (file.kind === 'missing')
      throw fileError(`${uri.fsPath} not found`, FileSystemProviderErrorCode.FileNotFound)
    if (file.kind === 'binary')
      throw fileError(`${uri.fsPath} is binary`, FileSystemProviderErrorCode.Unavailable)
    return encoder.encode(file.text)
  }

  watch(): IDisposable {
    return Disposable.None
  }

  readdir(): Promise<[string, FileType][]> {
    return Promise.resolve([])
  }

  writeFile(): Promise<void> {
    return Promise.reject(
      fileError('Saved by the editor tabs', FileSystemProviderErrorCode.NoPermissions)
    )
  }

  mkdir(): Promise<void> {
    return this.writeFile()
  }

  delete(): Promise<void> {
    return this.writeFile()
  }

  rename(): Promise<void> {
    return this.writeFile()
  }
}
