import { execFile } from 'node:child_process'
import { open, readFile, readlink, stat, type FileHandle } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { promisify } from 'node:util'
import { descendantsInListing } from '../terminal/process-tree'

export type OwnerIdentity = { pid: number; pidNamespace: string; startTicks: string }
const ps = promisify(execFile)
const candidateLimit = 128

export async function observeProcess(handle: FileHandle) {
  const buffer = Buffer.alloc(4096)
  const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
  const text = buffer.toString('utf8', 0, bytesRead)
  const delimiter = text.lastIndexOf(') ')
  const [state, parent, , , tty, ...fields] = text
    .slice(delimiter + 2)
    .trim()
    .split(/\s+/)
  const startTicks = fields[14]
  if (delimiter < 0 || !state || !parent || !tty || !startTicks || bytesRead === buffer.length)
    throw new Error('Invalid process observation')
  return { alive: !['Z', 'X', 'x'].includes(state), parent: Number(parent), tty, startTicks }
}

export async function pinProcess(pid: number) {
  const handle = await open(`/proc/${pid}/stat`, 'r')
  try {
    const observation = await observeProcess(handle)
    if (!observation.alive) throw new Error('Process already ended')
    return { handle, pid, ...observation }
  } catch (error) {
    await handle.close()
    throw error
  }
}

export type PinnedProcess = Awaited<ReturnType<typeof pinProcess>>

async function identityMatches(pid: number, identity: OwnerIdentity) {
  const status = await readFile(`/proc/${pid}/status`, 'utf8')
  const localPid = /^NSpid:\s*([^\n]+)/m.exec(status)?.[1]?.trim().split(/\s+/).at(-1)
  if (localPid !== String(identity.pid)) return false
  const namespace = await stat(`/proc/${pid}/ns/pid`, { bigint: true })
  return namespace.ino.toString() === identity.pidNamespace
}

async function observedCwd(pid: number): Promise<string | null> {
  try {
    const link = `/proc/${pid}/cwd`
    const path = await readlink(link)
    if (!isAbsolute(path) || path.endsWith(' (deleted)')) return null
    const [owner, host] = await Promise.all([
      stat(link, { bigint: true }),
      stat(path, { bigint: true })
    ])
    return owner.dev === host.dev && owner.ino === host.ino ? path : null
  } catch {
    return null
  }
}

async function remainsBelow(pid: number, root: PinnedProcess, signal: AbortSignal) {
  for (let depth = 0; depth < candidateLimit && pid > 1 && !signal.aborted; depth++) {
    if (pid === root.pid) return true
    const next = await pinProcess(pid)
    await next.handle.close()
    pid = next.parent
  }
  return false
}

export async function findOwner(root: PinnedProcess, identity: OwnerIdentity, signal: AbortSignal) {
  const { stdout } = await ps('ps', ['-A', '-o', 'pid=', '-o', 'ppid='], {
    signal,
    timeout: 1000,
    maxBuffer: 256 * 1024
  })
  const candidates = descendantsInListing(stdout, root.pid)
  if (candidates.length > candidateLimit) return undefined
  let match: (PinnedProcess & { cwd: string | null }) | undefined
  let keep = false
  try {
    for (const pid of candidates) {
      signal.throwIfAborted()
      const candidate = await pinProcess(pid).catch(() => undefined)
      if (!candidate) continue
      try {
        if (
          candidate.startTicks !== identity.startTicks ||
          candidate.tty !== root.tty ||
          !(await identityMatches(pid, identity))
        )
          continue
        if (match) return undefined
        match = { ...candidate, cwd: null }
      } catch {
        return undefined
      } finally {
        if (match?.handle !== candidate.handle) await candidate.handle.close()
      }
    }
    if (!match || !(await remainsBelow(match.pid, root, signal))) return undefined
    match.cwd = await observedCwd(match.pid)
    const [owner, shell] = await Promise.all([
      observeProcess(match.handle),
      observeProcess(root.handle)
    ])
    if (
      !owner.alive ||
      !shell.alive ||
      owner.tty !== root.tty ||
      shell.tty !== root.tty ||
      owner.startTicks !== match.startTicks ||
      shell.startTicks !== root.startTicks ||
      signal.aborted
    )
      return undefined
    keep = true
    return match
  } finally {
    if (!keep) await match?.handle.close()
  }
}
