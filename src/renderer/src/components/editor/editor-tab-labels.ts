/** Windows paths from main use backslashes, the others slashes. */
const segments = (path: string): string[] => path.split(/[\\/]/).filter(Boolean)

export const separatorOf = (path: string): string => (path.includes('\\') ? '\\' : '/')

export const fileName = (path: string): string => segments(path).at(-1) ?? path

export type TabLabel = {
  name: string
  /** The folders that tell it apart from an open file of the same name, nearest last. */
  folder?: string
}

/**
 * Tab labels for open files: the name, and for files sharing a name, the fewest parent folders
 * that make each one different (`src` and `test` for two `index.ts`, not their whole paths).
 */
export function tabLabels(paths: readonly string[]): Map<string, TabLabel> {
  const byName = new Map<string, string[]>()
  for (const path of paths) {
    const name = fileName(path)
    byName.set(name, [...(byName.get(name) ?? []), path])
  }
  const labels = new Map<string, TabLabel>()
  for (const [name, group] of byName) {
    if (group.length === 1) {
      for (const path of group) labels.set(path, { name })
      continue
    }
    const parents = group.map((path) => segments(path).slice(0, -1))
    const longest = Math.max(...parents.map((folders) => folders.length))
    let depth = 1
    while (
      depth < longest &&
      new Set(parents.map((folders) => folders.slice(-depth).join('/'))).size < group.length
    ) {
      depth += 1
    }
    group.forEach((path, index) => {
      const folders = parents[index]?.slice(-depth) ?? []
      labels.set(path, { name, folder: folders.join(separatorOf(path)) })
    })
  }
  return labels
}
