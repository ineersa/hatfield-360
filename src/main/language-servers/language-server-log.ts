import { createHash } from 'node:crypto'
import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** A log past this size is moved aside (one older file kept) when its server next starts. */
const MAX_BYTES = 2 * 1024 * 1024

export type ServerLog = {
  path: string
  write: (text: string) => void
  /** Settles once everything written so far is on disk. */
  flushed: () => Promise<void>
}

/** The log of `server` for `root` in `folder`, one file per server and root, appended in order. */
export function openServerLog(folder: string, server: string, root: string): ServerLog {
  const slug = server.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const hash = createHash('sha256').update(root).digest('hex').slice(0, 12)
  const path = join(folder, `${slug}-${hash}.log`)
  let queue: Promise<void> = mkdir(folder, { recursive: true })
    .then(() => stat(path))
    .then((info) => (info.size > MAX_BYTES ? rename(path, `${path}.1`) : undefined))
    .catch(() => undefined)
  return {
    path,
    write: (text) => {
      // A log that can't be written must never stop the server.
      queue = queue.then(() => appendFile(path, text)).catch(() => undefined)
    },
    flushed: () => queue
  }
}
