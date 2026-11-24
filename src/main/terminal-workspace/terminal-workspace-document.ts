import { isAbsolute } from 'node:path'
import { isPlainObject } from '../../shared/plain-object'
import type {
  PaneLayout,
  SavedConversation,
  TerminalLayout,
  TerminalWorkspace
} from '../../shared/terminal-workspace-api'
import { isTerminalId } from '../terminal/terminal-request'

export const EMPTY_TERMINAL_WORKSPACE: TerminalWorkspace = {
  layout: { tabs: [], activeTabId: null },
  conversations: []
}
export const RECENT_MS = 14 * 24 * 60 * 60 * 1000
export const TERMINAL_WORKSPACE_VERSION = 1

function string(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length <= limit && !value.includes('\0')
}

function path(value: unknown): value is string | null {
  return value === null || (string(value, 4096) && isAbsolute(value))
}

function nullableString(value: unknown, limit: number): value is string | null {
  return value === null || string(value, limit)
}

export function parseTerminalLayout(value: unknown, runtime = false): TerminalLayout | null {
  if (!isPlainObject(value) || !Array.isArray(value.tabs) || value.tabs.length > 256) return null
  const panes = new Set<string>()
  const conversations = new Set<string>()
  function tree(node: unknown, depth: number): PaneLayout | null {
    if (!isPlainObject(node) || depth > 64 || panes.size >= 2048) return null
    if (node.kind === 'pane') {
      if (
        !isTerminalId(node.id) ||
        panes.has(node.id) ||
        (node.conversation !== null && !isTerminalId(node.conversation))
      )
        return null
      panes.add(node.id)
      const conversation =
        node.conversation && !conversations.has(node.conversation) ? node.conversation : null
      if (conversation) conversations.add(conversation)
      return {
        kind: 'pane',
        id: node.id,
        conversation,
        ...(runtime && isTerminalId(node.terminalId) ? { terminalId: node.terminalId } : {})
      }
    }
    if (
      node.kind !== 'split' ||
      (node.direction !== 'vertical' && node.direction !== 'horizontal') ||
      typeof node.ratio !== 'number' ||
      !(node.ratio > 0 && node.ratio < 1)
    )
      return null
    const first = tree(node.first, depth + 1)
    const second = tree(node.second, depth + 1)
    return first && second
      ? { kind: 'split', direction: node.direction, ratio: node.ratio, first, second }
      : null
  }
  const tabs: TerminalLayout['tabs'] = []
  const ids = new Set<string>()
  for (const tab of value.tabs) {
    if (
      !isPlainObject(tab) ||
      !isTerminalId(tab.id) ||
      ids.has(tab.id) ||
      !path(tab.cwd) ||
      !string(tab.label, 4096)
    )
      return null
    const previousPanes = new Set(panes)
    const layout = tree(tab.layout, 0)
    if (!layout) return null
    ids.add(tab.id)
    tabs.push({
      id: tab.id,
      cwd: tab.cwd,
      label: tab.label,
      layout,
      activePane:
        isTerminalId(tab.activePane) &&
        panes.has(tab.activePane) &&
        !previousPanes.has(tab.activePane)
          ? tab.activePane
          : null
    })
  }
  return {
    tabs,
    activeTabId:
      isTerminalId(value.activeTabId) && ids.has(value.activeTabId)
        ? value.activeTabId
        : (tabs[0]?.id ?? null)
  }
}

function timestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function parseConversation(value: unknown): SavedConversation | null {
  if (
    !isPlainObject(value) ||
    !isTerminalId(value.id) ||
    (value.provider !== 'hatfield' && value.provider !== 'claude') ||
    !nullableString(value.providerSessionId, 1024) ||
    !nullableString(value.title, 4096) ||
    !path(value.cwd) ||
    value.cwd === null ||
    !path(value.project) ||
    !path(value.worktree) ||
    !nullableString(value.branch, 4096) ||
    !timestamp(value.updatedAt) ||
    (value.closedAt !== null && !timestamp(value.closedAt)) ||
    (value.process !== 'running' && value.process !== 'unknown' && value.process !== 'exited') ||
    (value.activity !== 'working' && value.activity !== 'idle' && value.activity !== 'unknown')
  )
    return null
  const {
    id,
    provider,
    providerSessionId,
    title,
    cwd,
    project,
    worktree,
    branch,
    updatedAt,
    closedAt,
    process,
    activity
  } = value
  return {
    id,
    provider,
    providerSessionId,
    title,
    cwd,
    project,
    worktree,
    branch,
    updatedAt,
    closedAt,
    process,
    activity
  }
}

export function parseTerminalWorkspace(value: unknown): TerminalWorkspace {
  if (!isPlainObject(value) || value.version !== TERMINAL_WORKSPACE_VERSION)
    return EMPTY_TERMINAL_WORKSPACE
  const conversations = Array.isArray(value.conversations)
    ? value.conversations.slice(0, 10_000).flatMap((item: unknown) => parseConversation(item) ?? [])
    : []
  return {
    layout: parseTerminalLayout(value.layout) ?? EMPTY_TERMINAL_WORKSPACE.layout,
    conversations
  }
}
