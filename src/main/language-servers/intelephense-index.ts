import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Whether Intelephense must rebuild its index of `root` from scratch: it keeps files it indexed
 * before a folder was excluded, so a newly excluded folder's files would stay. Records `exclude`.
 */
export async function indexNeedsClearing(
  storage: string,
  root: string,
  exclude: readonly string[]
): Promise<boolean> {
  const record = join(
    storage,
    `exclude-${createHash('sha256').update(root).digest('hex').slice(0, 16)}.json`
  )
  const before = await readFile(record, 'utf8')
    .then((text): unknown => JSON.parse(text))
    .catch(() => null)
  const known = new Set(Array.isArray(before) ? before : [])
  const grew = before === null || exclude.some((glob) => !known.has(glob))
  if (grew || exclude.length !== known.size) {
    await mkdir(storage, { recursive: true })
    await writeFile(record, JSON.stringify(exclude))
  }
  return grew
}
