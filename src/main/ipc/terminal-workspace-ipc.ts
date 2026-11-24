import type { WebContents } from 'electron'
import { TERMINAL_WORKSPACE_CHANNELS } from '../../shared/terminal-workspace-api'
import { parseTerminalLayout } from '../terminal-workspace/terminal-workspace-document'
import { terminalWorkspaceStore } from '../terminal-workspace/terminal-workspace-store'
import { resumeConversations } from '../terminal-workspace/resume-conversation'
import type { trackAgentSessions } from '../agent-status/agent-sessions'
import { gridSize, isTerminalId } from '../terminal/terminal-request'
import { handleTrusted } from './trusted-ipc'

export function registerTerminalWorkspaceIpc(launch: ReturnType<typeof trackAgentSessions>): void {
  const resume = resumeConversations(launch)
  handleTrusted(TERMINAL_WORKSPACE_CHANNELS.load, () => terminalWorkspaceStore.view())
  handleTrusted(TERMINAL_WORKSPACE_CHANNELS.checkpoint, (event, value) => {
    const layout = parseTerminalLayout(value, true)
    if (!layout) throw new Error('Invalid terminal layout.')
    return terminalWorkspaceStore.checkpoint(event.sender, layout)
  })
  handleTrusted(TERMINAL_WORKSPACE_CHANNELS.forget, (event, id) => {
    if (!isTerminalId(id)) throw new Error('Invalid conversation.')
    return terminalWorkspaceStore.forget(event.sender, id)
  })
  const attempts = new WeakMap<WebContents, Map<string, AbortController>>()
  handleTrusted(TERMINAL_WORKSPACE_CHANNELS.cancelResume, (event, attempt) => {
    if (!isTerminalId(attempt)) throw new Error('Invalid resume attempt.')
    attempts.get(event.sender)?.get(attempt)?.abort()
  })
  handleTrusted(TERMINAL_WORKSPACE_CHANNELS.resume, async (event, id, attempt, cols, rows) => {
    const size = gridSize(cols, rows)
    if (!isTerminalId(id) || !isTerminalId(attempt) || !size)
      throw new Error('Invalid resume request.')
    const owner = event.sender
    let active = attempts.get(owner)
    if (!active) {
      active = new Map()
      attempts.set(owner, active)
      const ownedAttempts = active
      const cancel = () => {
        for (const controller of ownedAttempts.values()) controller.abort()
      }
      owner.on('render-process-gone', cancel)
      owner.once('destroyed', cancel)
      owner.on('did-start-navigation', (details) => {
        if (details.isMainFrame && !details.isSameDocument) cancel()
      })
    }
    if (active.has(attempt)) throw new Error('Resume attempt already exists.')
    const controller = new AbortController()
    active.set(attempt, controller)
    try {
      const saved = (await terminalWorkspaceStore.view()).conversations.find(
        (item) => item.id === id
      )
      if (!saved)
        return {
          failure: {
            reason: 'conversation unavailable',
            detail: 'This conversation is no longer in session history.',
            settings: false
          }
        }
      return await resume(owner, saved, size, controller.signal)
    } finally {
      active.delete(attempt)
    }
  })
}
