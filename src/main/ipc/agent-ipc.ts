import { conversationKey } from '../../shared/recent-conversation'
import { listClaudeCatalog } from '../workspace/claude-catalog'
import { basename } from 'node:path'
import { BrowserWindow } from 'electron'
import { AGENT_CHANNELS, type AgentNotification } from '../../shared/agent-api'
import { isPlainObject } from '../../shared/plain-object'
import { agentSnapshot, trackAgentSessions } from '../agent-status/agent-sessions'
import { worktreeStore } from '../git/worktree-store'
import { settingsStore } from '../settings/settings-store'
import { gridSize, isTerminalId } from '../terminal/terminal-request'
import { terminalSessions } from '../terminal/terminal-sessions'
import { workspaceStore } from '../workspace/workspace-store'
import { existingDirectory } from './terminal-ipc'
import { handleTrusted } from './trusted-ipc'

async function recentCatalog(generation: unknown, sessionId?: string) {
  const workspace = await workspaceStore.view()
  if (generation !== workspace.terminalGeneration) throw new Error('The workspace has changed.')
  const sessions = await listClaudeCatalog(
    workspace.folders,
    worktreeStore.view(),
    Date.now(),
    sessionId
  )
  if (generation !== (await workspaceStore.view()).terminalGeneration)
    throw new Error('The workspace has changed.')
  return sessions
}

export function registerAgentIpc(): void {
  const launch = trackAgentSessions(
    (owner) => owner.send(AGENT_CHANNELS.changed, agentSnapshot(owner)),
    (owner, notice) => {
      const window = BrowserWindow.fromWebContents(owner)
      owner.send(AGENT_CHANNELS.notification, {
        ...notice,
        ownerWindowFocusedAndVisible: window?.isVisible() === true && window.isFocused()
      } satisfies AgentNotification)
    }
  )
  handleTrusted(AGENT_CHANNELS.get, (event) => agentSnapshot(event.sender))
  handleTrusted(AGENT_CHANNELS.recent, (_event, generation) => recentCatalog(generation))
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
    if (isPlainObject(target.restore) || isPlainObject(target.recent)) {
      let saved:
        | {
            cwd: string | null
            agent: { provider: string; providerSessionId: string | null; project: string | null }
          }
        | undefined
      if (isPlainObject(target.restore)) {
        const { generation, paneId } = target.restore
        if (typeof generation !== 'number' || !isTerminalId(paneId))
          throw new Error('Invalid saved pane.')
        const pane = await workspaceStore.savedPane(generation, paneId)
        if (pane?.agent) saved = { cwd: pane.cwd, agent: pane.agent }
      } else if (isPlainObject(target.recent)) {
        const { generation, key } = target.recent
        if (typeof generation !== 'number' || typeof key !== 'string' || key.length > 100)
          throw new Error('Invalid Recent conversation.')
        const id = /^\["claude","([\da-f-]{36})",null\]$/u.exec(key)?.[1]
        if (!id || provider !== 'claude') throw new Error('Invalid Recent conversation.')
        const entry = (await recentCatalog(generation, id)).find(
          (session) => conversationKey(session) === key
        )
        if (entry) saved = { cwd: entry.cwd, agent: entry }
      }
      const id = saved?.agent.providerSessionId
      if (
        saved?.agent.provider !== provider ||
        !id ||
        !(provider === 'hatfield'
          ? /^\d+$/.test(id)
          : /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id))
      )
        throw new Error('The saved conversation ID is unavailable.')
      if (!saved.cwd) throw new Error('The saved conversation folder is unavailable.')
      const profile = (await settingsStore.view()).values[`agents.${provider}`]
      const directClaudePrompt =
        provider === 'claude' &&
        basename(profile.executable) === 'claude' &&
        !!profile.args[0] &&
        !profile.args[0].startsWith('-')
      if (
        directClaudePrompt ||
        profile.args.some((arg) =>
          /^(?:--(?:resume|continue|fork-session|from-pr|session-id|prompt|print|cwd|storage)(?:=|$)|-[rcp]|--)$/u.test(
            arg.split('=')[0] ?? ''
          )
        )
      )
        throw new Error(
          'Remove conversation, prompt or folder overrides from the agent profile in Settings.'
        )
      const directory = await existingDirectory(saved.cwd)
      if (
        isPlainObject(target.recent) &&
        target.recent.generation !== (await workspaceStore.view()).terminalGeneration
      )
        throw new Error('The workspace has changed.')
      return launch(
        event.sender,
        provider,
        {
          ...profile,
          args: [
            ...profile.args,
            ...(provider === 'hatfield' ? [`--resume=${id}`] : ['--resume', id])
          ]
        },
        saved.agent.project,
        { ...size, cwd: directory },
        id
      )
    }
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
