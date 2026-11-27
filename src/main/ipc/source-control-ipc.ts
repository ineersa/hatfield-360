import type { WebContents } from 'electron'
import { isPlainObject } from '../../shared/plain-object'
import { BRANCH_CHANNELS } from '../../shared/branch-api'
import { type GitOutcome, SOURCE_CONTROL_CHANNELS } from '../../shared/source-control-api'
import { createBranch, deleteBranch, listBranches, switchBranch } from '../git/branches'
import { sourceControlStatus, workingTreeOf } from '../git/source-control-groups'
import {
  abortOperation,
  addUntrackedFiles,
  commitChanges,
  fetchRemote,
  ignoreUntrackedFile,
  lastCommitMessage,
  leftoverIndexLock,
  pullBranch,
  pushBranch,
  rollbackChanges
} from '../git/source-control'
import { worktreeStore } from '../git/worktree-store'
import { launchHunk } from '../terminal/hunk-terminal'
import { gridSize } from '../terminal/terminal-request'
import { existingDirectory } from './terminal-ipc'
import { handleTrusted } from './trusted-ipc'
import { worktreesListed } from './worktree-ipc'

/** The workspace working tree a request names, once the worktrees have been listed. */
async function workingTree(root: unknown) {
  await worktreesListed()
  return workingTreeOf(worktreeStore.view(), root)
}

/** The git action each window is running, by its webContents id: only that window may stop it. */
const runningActions = new Map<number, AbortController>()

/** Runs `action` so the window that asked can cancel it; a cancelled one reports a leftover lock. */
async function cancellable<T extends GitOutcome>(
  sender: WebContents,
  root: string,
  action: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController()
  runningActions.get(sender.id)?.abort()
  runningActions.set(sender.id, controller)
  try {
    const result = await action(controller.signal)
    if (result.ok || !result.cancelled) return result
    const lock = await leftoverIndexLock(root)
    return lock === null
      ? result
      : {
          ...result,
          output: `${result.output}${result.output === '' || result.output.endsWith('\n') ? '' : '\n'}${lock} is still there. If no other git command is running in this repository, delete it.\n`
        }
  } finally {
    if (runningActions.get(sender.id) === controller) runningActions.delete(sender.id)
  }
}

/** Runs a branch action, then lists the project's worktrees again: their branches changed. */
async function onBranches<T extends GitOutcome>(
  sender: WebContents,
  request: unknown,
  action: (root: string, signal: AbortSignal) => Promise<T>
): Promise<T> {
  const { root, project } = await workingTree(request)
  try {
    return await cancellable(sender, root, (signal) => action(root, signal))
  } finally {
    await worktreeStore.relist(project)
  }
}

export function registerSourceControlIpc(): void {
  handleTrusted(SOURCE_CONTROL_CHANNELS.status, async () => {
    await worktreesListed()
    return sourceControlStatus(worktreeStore.view())
  })

  handleTrusted(SOURCE_CONTROL_CHANNELS.commit, async (event, request) => {
    if (!isPlainObject(request) || typeof request.amend !== 'boolean')
      throw new Error('Invalid commit request.')
    const { root } = await workingTree(request.root)
    const { paths, message, amend } = request
    return cancellable(event.sender, root, (signal) =>
      commitChanges(root, { paths, message, amend }, signal)
    )
  })

  handleTrusted(SOURCE_CONTROL_CHANNELS.lastCommitMessage, async (_event, root) =>
    lastCommitMessage((await workingTree(root)).root)
  )

  handleTrusted(SOURCE_CONTROL_CHANNELS.push, async (event, request) => {
    const { root } = await workingTree(request)
    return cancellable(event.sender, root, (signal) => pushBranch(root, signal))
  })

  handleTrusted(SOURCE_CONTROL_CHANNELS.pull, async (event, request) => {
    const { root } = await workingTree(request)
    return cancellable(event.sender, root, (signal) => pullBranch(root, signal))
  })

  handleTrusted(SOURCE_CONTROL_CHANNELS.rollback, async (event, request, paths) => {
    const { root } = await workingTree(request)
    return cancellable(event.sender, root, (signal) => rollbackChanges(root, paths, signal))
  })

  handleTrusted(SOURCE_CONTROL_CHANNELS.fetch, async (event, request) => {
    const { root } = await workingTree(request)
    return cancellable(event.sender, root, (signal) => fetchRemote(root, signal))
  })

  handleTrusted(SOURCE_CONTROL_CHANNELS.addUntracked, async (event, request, paths) => {
    const { root } = await workingTree(request)
    return cancellable(event.sender, root, (signal) => addUntrackedFiles(root, paths, signal))
  })

  handleTrusted(SOURCE_CONTROL_CHANNELS.ignoreUntracked, async (_event, root, path) =>
    ignoreUntrackedFile((await workingTree(root)).root, path)
  )

  handleTrusted(SOURCE_CONTROL_CHANNELS.abortOperation, async (event, request, operation) => {
    const { root } = await workingTree(request)
    return cancellable(event.sender, root, (signal) => abortOperation(root, operation, signal))
  })

  handleTrusted(BRANCH_CHANNELS.list, async (_event, root) =>
    listBranches((await workingTree(root)).root)
  )

  handleTrusted(BRANCH_CHANNELS.switch, (event, root, branch) =>
    onBranches(event.sender, root, (place, signal) => switchBranch(place, branch, signal))
  )

  handleTrusted(BRANCH_CHANNELS.create, (event, request) => {
    if (!isPlainObject(request)) throw new Error('Invalid branch request.')
    const { name, start, switchTo } = request
    return onBranches(event.sender, request.root, (place, signal) =>
      createBranch(place, { name, start, switchTo }, signal)
    )
  })

  handleTrusted(BRANCH_CHANNELS.delete, (event, root, name, force) =>
    onBranches(event.sender, root, (place, signal) => deleteBranch(place, name, force, signal))
  )

  handleTrusted(SOURCE_CONTROL_CHANNELS.cancel, (event) => {
    runningActions.get(event.sender.id)?.abort()
  })

  handleTrusted(SOURCE_CONTROL_CHANNELS.launchHunk, async (event, request) => {
    if (!isPlainObject(request) || (request.kind !== 'review' && request.kind !== 'log'))
      throw new Error('Invalid hunk request.')
    const size = gridSize(request.cols, request.rows)
    if (!size) throw new Error('Invalid hunk terminal size.')
    const place = await workingTree(request.root)
    await existingDirectory(place.root)
    return launchHunk(event.sender, place, request.kind, size)
  })
}
