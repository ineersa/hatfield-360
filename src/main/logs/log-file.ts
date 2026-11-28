import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { dirname } from 'node:path'

/** A log past this size is moved aside (one older file kept) when it is next opened. */
const MAX_BYTES = 2 * 1024 * 1024

export type LogFile = {
  path: string
  write: (text: string) => void
  /** Settles once everything written so far is on disk. */
  flushed: () => Promise<void>
}

/** The log at `path`, appended in order, creating its folder; a write that fails is dropped. */
export function openLogFile(path: string): LogFile {
  let queue: Promise<void> = mkdir(dirname(path), { recursive: true })
    .then(() => stat(path))
    .then((info) => (info.size > MAX_BYTES ? rename(path, `${path}.1`) : undefined))
    .catch(() => undefined)
  return {
    path,
    write: (text) => {
      // A log that can't be written must never stop what it records.
      queue = queue.then(() => appendFile(path, text)).catch(() => undefined)
    },
    flushed: () => queue
  }
}
