import { createHash } from 'node:crypto'
import type { Stats } from 'node:fs'
import { open } from 'node:fs/promises'
import { EDITOR_FILE_LIMITS, type EditorFile } from '../../shared/editor-api'

/** A text file's version: a hash of its bytes, so a save of the same text matches it. */
export const textVersion = (bytes: Buffer | string): string =>
  createHash('sha256').update(bytes).digest('hex')

/** Files read in part have no hash of all their bytes; their size and modification time stand in. */
const statVersion = (info: Stats): string => `${info.size}:${info.mtimeMs}`

const isMissing = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')

/**
 * Reads a file for the editor without reading more than the editor shows: a binary file (a NUL byte
 * in its first bytes, git's test) is only sniffed, and a large one is read up to the limit.
 */
export async function readEditorFile(real: string): Promise<EditorFile> {
  const file = await open(real, 'r').catch((error: unknown) => {
    if (isMissing(error)) return null
    throw error
  })
  if (!file) return { kind: 'missing' }
  try {
    const info = await file.stat()
    if (!info.isFile()) throw new Error(`Not a file: ${real}`)
    const length = Math.min(info.size, EDITOR_FILE_LIMITS.editable)
    const buffer = Buffer.alloc(length)
    let read = 0
    while (read < length) {
      const { bytesRead } = await file.read(buffer, read, length - read, read)
      if (bytesRead === 0) break
      read += bytesRead
    }
    const bytes = buffer.subarray(0, read)
    if (bytes.subarray(0, EDITOR_FILE_LIMITS.sniff).includes(0)) {
      return { kind: 'binary', size: info.size, version: statVersion(info) }
    }
    if (info.size > EDITOR_FILE_LIMITS.editable) {
      // Cut at the last line break, so no line (or character) is shown half.
      const end = bytes.lastIndexOf(0x0a)
      const text = bytes.subarray(0, end === -1 ? bytes.length : end + 1).toString('utf8')
      return { kind: 'large', text, size: info.size, version: statVersion(info) }
    }
    return { kind: 'text', text: bytes.toString('utf8'), version: textVersion(bytes) }
  } finally {
    await file.close()
  }
}
