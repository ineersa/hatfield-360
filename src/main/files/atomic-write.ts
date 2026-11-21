import { randomBytes } from 'node:crypto'
import { mkdir, open, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

/**
 * Writes to a temp file and renames it over the target, so a crash never leaves a half-written
 * file. The replaced file keeps its permissions.
 */
export async function writeFileAtomic(path: string, contents: string): Promise<void> {
  const folder = dirname(path)
  await mkdir(folder, { recursive: true })
  const mode = await stat(path).then(
    (info) => info.mode & 0o7777,
    () => null
  )
  // Created exclusively under an unguessable name, so nothing planted at the temp path is followed.
  const temp = join(folder, `.${basename(path)}.${randomBytes(6).toString('hex')}.tmp`)
  const file = await open(temp, 'wx', mode ?? 0o666)
  try {
    try {
      await file.writeFile(contents, 'utf8')
      // `open` applies the umask; an existing file's mode is restored exactly.
      if (mode !== null) await file.chmod(mode)
    } finally {
      await file.close()
    }
    await rename(temp, path)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
}
