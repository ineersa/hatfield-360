import { execFile } from 'node:child_process'

/** Every process below `root` in a `ps -A -o pid= -o ppid=` listing, children before grandchildren. */
export function descendantsInListing(listing: string, root: number): number[] {
  const children = new Map<number, number[]>()
  for (const line of listing.split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number)
    if (!pid || ppid === undefined || Number.isNaN(ppid)) continue
    const siblings = children.get(ppid) ?? []
    siblings.push(pid)
    children.set(ppid, siblings)
  }
  const found: number[] = []
  const queue = [root]
  for (let parent = queue.shift(); parent !== undefined; parent = queue.shift()) {
    for (const child of children.get(parent) ?? []) {
      if (found.includes(child) || child === root) continue
      found.push(child)
      queue.push(child)
    }
  }
  return found
}

/**
 * The processes a shell started, directly or not (Unix only). Taken before the shell is hung up:
 * once it exits its children are reparented and can no longer be told apart.
 */
export function descendantPids(root: number): Promise<number[]> {
  return new Promise((resolve) => {
    execFile('ps', ['-A', '-o', 'pid=', '-o', 'ppid='], (error, stdout) => {
      resolve(error ? [] : descendantsInListing(stdout, root))
    })
  })
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
