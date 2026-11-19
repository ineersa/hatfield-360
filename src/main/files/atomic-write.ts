import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Writes to a temp file and renames it over the target, so a crash never leaves a half-written file. */
export async function writeFileAtomic(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.tmp`
  await writeFile(temp, contents, 'utf8')
  await rename(temp, path)
}
