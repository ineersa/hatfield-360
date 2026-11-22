import { AGENT_CHANNELS } from '../../shared/agent-api'
import { isPlainObject } from '../../shared/plain-object'
import { agentSnapshot, trackAgentSessions } from '../agent-status/agent-sessions'
import { worktreeStore } from '../git/worktree-store'
import { settingsStore } from '../settings/settings-store'
import { gridSize, isTerminalId } from '../terminal/terminal-request'
import { terminalSessions } from '../terminal/terminal-sessions'
import { workspaceStore } from '../workspace/workspace-store'
import { existingDirectory } from './terminal-ipc'
import { handleTrusted } from './trusted-ipc'

export function registerAgentIpc(): void {
  const launch = trackAgentSessions((owner) =>
    owner.send(AGENT_CHANNELS.changed, agentSnapshot(owner))
  )
  handleTrusted(AGENT_CHANNELS.get, (event) => agentSnapshot(event.sender))
  handleTrusted(AGENT_CHANNELS.launch, async (event, value) => {
    if (
      !isPlainObject(value) ||
      (value.provider !== 'hatfield' && value.provider !== 'claude') ||
      !isPlainObject(value.target)
    )
      throw new Error('Invalid agent launch request.')
    const size = gridSize(value.cols, value.rows)
    if (!size) throw new Error('Invalid agent terminal size.')
    const { target, provider } = value
    const folders = (await workspaceStore.view()).folders.filter((folder) => !folder.missing)
    let cwd: string
    let project: string | null
    if (isTerminalId(target.sourceTerminalId)) {
      const placement = terminalSessions.directory(event.sender, target.sourceTerminalId)
      if (!placement) throw new Error('The original terminal is no longer available.')
      cwd = placement.cwd
      const linked = worktreeStore
        .view()
        .find(
          (entry) =>
            entry.status === 'git' &&
            entry.worktrees.some((tree) => tree.path === cwd && !tree.prunable)
        )
      project =
        placement.project ??
        folders.find((folder) => folder.path === cwd)?.path ??
        linked?.folder ??
        null
    } else {
      if (
        typeof target.project !== 'string' ||
        typeof target.cwd !== 'string' ||
        !folders.some((folder) => folder.path === target.project)
      )
        throw new Error('Choose a project in the current workspace.')
      project = target.project
      cwd = target.cwd
      const linked = worktreeStore.view().find((entry) => entry.folder === project)
      if (
        cwd !== project &&
        !(
          linked?.status === 'git' &&
          linked.worktrees.some((tree) => tree.path === cwd && !tree.prunable)
        )
      )
        throw new Error('Choose a worktree belonging to this project.')
    }
    const settings = await settingsStore.view()
    return launch(event.sender, provider, settings.values[`agents.${provider}`], project, {
      ...size,
      cwd: await existingDirectory(cwd)
    })
  })
}
