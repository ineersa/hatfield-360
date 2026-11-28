import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { type LogFile, openLogFile } from '../logs/log-file'

export type ServerLog = LogFile

/** The log of `server` for `root` in `folder`, one file per server and root, appended in order. */
export function openServerLog(folder: string, server: string, root: string): ServerLog {
  const slug = server.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const hash = createHash('sha256').update(root).digest('hex').slice(0, 12)
  return openLogFile(join(folder, `${slug}-${hash}.log`))
}
