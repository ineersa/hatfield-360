import { inflateRawSync } from 'node:zlib'

const END_OF_CENTRAL_DIRECTORY = 0x06054b50
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50
const LOCAL_FILE_HEADER = 0x04034b50
const STORED = 0
const DEFLATED = 8

/** The file entries of a zip archive (a JetBrains `.jar`), each read on demand. */
export function zipEntries(archive: Buffer): Map<string, () => Buffer> {
  const end = findEndOfCentralDirectory(archive)
  const count = archive.readUInt16LE(end + 10)
  let offset = archive.readUInt32LE(end + 16)
  if (count === 0xffff || offset === 0xffffffff) throw new Error('ZIP64 archives are not supported')
  const entries = new Map<string, () => Buffer>()
  for (let index = 0; index < count; index++) {
    if (archive.readUInt32LE(offset) !== CENTRAL_DIRECTORY_ENTRY) {
      throw new Error('Damaged zip central directory')
    }
    const method = archive.readUInt16LE(offset + 10)
    const compressedSize = archive.readUInt32LE(offset + 20)
    const nameLength = archive.readUInt16LE(offset + 28)
    const extraLength = archive.readUInt16LE(offset + 30)
    const commentLength = archive.readUInt16LE(offset + 32)
    const localHeader = archive.readUInt32LE(offset + 42)
    const name = archive.toString('utf8', offset + 46, offset + 46 + nameLength)
    offset += 46 + nameLength + extraLength + commentLength
    if (name.endsWith('/')) continue
    entries.set(name, () => readEntry(archive, localHeader, method, compressedSize, name))
  }
  return entries
}

function findEndOfCentralDirectory(archive: Buffer): number {
  // The record is 22 bytes plus a comment of at most 65535 bytes, at the very end.
  const lowest = Math.max(0, archive.length - 22 - 0xffff)
  for (let offset = archive.length - 22; offset >= lowest; offset--) {
    if (archive.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) return offset
  }
  throw new Error('Not a zip archive')
}

function readEntry(
  archive: Buffer,
  header: number,
  method: number,
  size: number,
  name: string
): Buffer {
  if (archive.readUInt32LE(header) !== LOCAL_FILE_HEADER)
    throw new Error(`Damaged zip entry ${name}`)
  const start = header + 30 + archive.readUInt16LE(header + 26) + archive.readUInt16LE(header + 28)
  const data = archive.subarray(start, start + size)
  if (method === STORED) return Buffer.from(data)
  if (method === DEFLATED) return inflateRawSync(data)
  throw new Error(`Zip entry ${name} uses unsupported compression method ${method}`)
}
