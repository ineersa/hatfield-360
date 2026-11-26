import { isPlainObject } from '../../shared/plain-object'
import { SOURCE_CONTROL_CHANNELS } from '../../shared/source-control-api'
import { sourceControlStatus, workingTreeOf } from '../git/source-control-groups'
import {
  commitChanges,
  lastCommitMessage,
  pullBranch,
  pushBranch,
  rollbackChanges
} from '../git/source-control'
import { worktreeStore } from '../git/worktree-store'
import { hunkArgs, launchHunk } from '../terminal/hunk-terminal'
import { gridSize } from '../terminal/terminal-request'
import { existingDirectory } from './terminal-ipc'
import { handleTrusted } from './trusted-ipc'
import { worktreesListed } from './worktree-ipc'

/** The workspace working tree a request names, once the worktrees have been listed. */
async function workingTree(root: unknown) {
  await worktreesListed()
  return workingTreeOf(worktreeStore.view(), root)
}

export function registerSourceControlIpc(): void {
  handleTrusted(SOURCE_CONTROL_CHANNELS.status, async () => {
    await worktreesListed()
    return sourceControlStatus(worktreeStore.view())
  })

  handleTrusted(SOURCE_CONTROL_CHANNELS.commit, async (_event, request) => {
    if (!isPlainObject(request) || typeof request.amend !== 'boolean')
      throw new Error('Invalid commit request.')
    const { root } = await workingTree(request.root)
    const { paths, message, amend } = request
    return commitChanges(root, { paths, message, amend })
  })

  handleTrusted(SOURCE_CONTROL_CHANNELS.lastCommitMessage, async (_event, root) =>
    lastCommitMessage((await workingTree(root)).root)
  )

  handleTrusted(SOURCE_CONTROL_CHANNELS.push, async (_event, root) =>
    pushBranch((await workingTree(root)).root)
  )

  handleTrusted(SOURCE_CONTROL_CHANNELS.pull, async (_event, root) =>
    pullBranch((await workingTree(root)).root)
  )

  handleTrusted(SOURCE_CONTROL_CHANNELS.rollback, async (_event, root, paths) =>
    rollbackChanges((await workingTree(root)).root, paths)
  )

  handleTrusted(SOURCE_CONTROL_CHANNELS.launchHunk, async (event, request) => {
    if (!isPlainObject(request)) throw new Error('Invalid hunk request.')
    const size = gridSize(request.cols, request.rows)
    if (!size) throw new Error('Invalid hunk terminal size.')
    const place = await workingTree(request.root)
    await existingDirectory(place.root)
    return launchHunk(event.sender, place, await hunkArgs(place.root, request), size)
  })
}
