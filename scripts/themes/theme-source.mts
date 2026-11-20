import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'
import { zipEntries } from './zip-archive.mts'

/** Files from a folder, a plugin `.jar` or a single scheme file, keyed by `/`-separated path. */
export type ThemeSource = {
  /** Where the files came from, for messages. */
  origin: string
  files: Map<string, () => Buffer>
}

function folderFiles(folder: string): Map<string, () => Buffer> {
  const files = new Map<string, () => Buffer>()
  for (const entry of readdirSync(folder, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const path = join(entry.parentPath, entry.name)
    files.set(relative(folder, path).split(sep).join('/'), () => readFileSync(path))
  }
  return files
}

export function openThemeSource(path: string): ThemeSource {
  if (statSync(path).isDirectory()) return { origin: path, files: folderFiles(path) }
  if (/\.(jar|zip)$/i.test(path)) return { origin: path, files: zipEntries(readFileSync(path)) }
  return { origin: path, files: new Map([[basename(path), () => readFileSync(path)]]) }
}

export function readText(source: ThemeSource, path: string): string {
  const read = source.files.get(path.replace(/^\//, ''))
  if (!read) throw new Error(`${source.origin} has no ${path}`)
  return read().toString('utf8')
}
