import type { PaneLayout } from '../../shared/terminal-workspace-api'
import { agentSnapshot, resumeDirectory } from '../agent-status/agent-sessions'
import { terminalSessions } from '../terminal/terminal-sessions'
import { parseTerminalLayout } from '../workspace/terminal-layout'
import { BrowserWindow } from 'electron'
import { isPlainObject } from '../../shared/plain-object'
import { type RecentTarget, WORKSPACE_CHANNELS } from '../../shared/workspace-api'
import {
  openRecentOrOfferRemoval,
  pickAndAddWorkspaceFolder,
  pickAndOpenWorkspaceFile
} from '../workspace/workspace-dialogs'
import { workspaceStore } from '../workspace/workspace-store'
import { handleTrusted } from './trusted-ipc'

function parseRecentTarget(value: unknown): RecentTarget {
  if (
    isPlainObject(value) &&
    (value.kind === 'default' || value.kind === 'workspace' || value.kind === 'folder') &&
    typeof value.path === 'string'
  ) {
    return { kind: value.kind, path: value.path }
  }
  throw new Error('Expected a Recent entry')
}

export function registerWorkspaceIpc(): void {
  handleTrusted(WORKSPACE_CHANNELS.checkpointTerminals, (event, generation, value) => {
    const layout = parseTerminalLayout(value, true)
    if (!layout || typeof generation !== 'number' || !Number.isSafeInteger(generation))
      throw new Error('Invalid terminal layout.')
    const sessions = agentSnapshot(event.sender).sessions
    const ended = new Set<string>()
    const save = (node: PaneLayout): PaneLayout => {
      if (node.kind === 'split')
        return { ...node, first: save(node.first), second: save(node.second) }
      const { terminalId, ...leaf } = node
      const placement = terminalId ? terminalSessions.directory(event.sender, terminalId) : null
      const session =
        placement &&
        sessions.findLast((item) => item.terminalId === terminalId && item.process === 'running')
      if (terminalId && !placement) ended.add(leaf.id)
      if (!session) return { ...leaf, cwd: placement?.cwd ?? leaf.cwd }
      if (leaf.agent && session.providerSessionId === null) return leaf
      const { provider, providerSessionId, title, project } = session
      return {
        ...leaf,
        cwd: resumeDirectory(session),
        agent: { provider, providerSessionId, title, project }
      }
    }
    return workspaceStore.checkpointTerminals(
      generation,
      {
        ...layout,
        tabs: layout.tabs.map((tab) => ({ ...tab, layout: save(tab.layout) }))
      },
      ended
    )
  })

  handleTrusted(WORKSPACE_CHANNELS.get, () => workspaceStore.view())

  handleTrusted(WORKSPACE_CHANNELS.addFolder, (event) =>
    pickAndAddWorkspaceFolder(BrowserWindow.fromWebContents(event.sender))
  )

  handleTrusted(WORKSPACE_CHANNELS.removeFolder, async (_event, path) => {
    if (typeof path !== 'string' || path === '') {
      throw new Error('removeWorkspaceFolder expects a folder path')
    }
    if (!(await workspaceStore.removeFolder(path))) {
      throw new Error(`Not in the workspace: ${path}`)
    }
  })

  handleTrusted(WORKSPACE_CHANNELS.setFolderKind, async (_event, path, kind) => {
    if (typeof path !== 'string' || path === '' || (kind !== 'project' && kind !== 'folder')) {
      throw new Error('setWorkspaceFolderKind expects a folder path and "project" or "folder"')
    }
    if (!(await workspaceStore.setFolderKind(path, kind))) {
      throw new Error(`Not in the workspace: ${path}`)
    }
  })

  handleTrusted(WORKSPACE_CHANNELS.openFile, (event) =>
    pickAndOpenWorkspaceFile(BrowserWindow.fromWebContents(event.sender))
  )

  handleTrusted(WORKSPACE_CHANNELS.openRecent, (event, target) =>
    openRecentOrOfferRemoval(BrowserWindow.fromWebContents(event.sender), parseRecentTarget(target))
  )

  handleTrusted(WORKSPACE_CHANNELS.removeRecent, (_event, target) =>
    workspaceStore.removeRecent(parseRecentTarget(target))
  )

  workspaceStore.onChange((view) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(WORKSPACE_CHANNELS.changed, view)
    }
  })
}
