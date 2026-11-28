import { isAbsolute } from 'node:path'
import { isPlainObject } from '../../shared/plain-object'
import type { PaneLayout, TerminalLayout } from '../../shared/terminal-workspace-api'
import { isTerminalId } from '../terminal/terminal-request'

function string(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length <= limit && !value.includes('\0')
}

function path(value: unknown): value is string | null {
  return value === null || (string(value, 4096) && isAbsolute(value))
}

function nullableString(value: unknown, limit: number): value is string | null {
  return value === null || string(value, limit)
}

export function parseTerminalLayout(
  value: unknown,
  runtime = false,
  salvage = false
): TerminalLayout | null {
  if (!isPlainObject(value) || !Array.isArray(value.tabs) || value.tabs.length > 256) return null
  const panes = new Set<string>()
  let budget = 4096
  function tree(node: unknown, depth: number): PaneLayout | null {
    if (!isPlainObject(node) || depth > 64 || --budget < 0) return null
    if (node.kind === 'pane') {
      if (!isTerminalId(node.id) || panes.has(node.id) || !path(node.cwd)) return null
      panes.add(node.id)
      const leaf: PaneLayout = { kind: 'pane', id: node.id, cwd: node.cwd }
      if (runtime && isTerminalId(node.terminalId)) leaf.terminalId = node.terminalId
      if (node.agent !== undefined) {
        const agent = node.agent
        if (
          !isPlainObject(agent) ||
          (agent.provider !== 'hatfield' && agent.provider !== 'claude') ||
          !nullableString(agent.providerSessionId, 128) ||
          !nullableString(agent.title, 1024) ||
          !path(agent.project)
        )
          return null
        leaf.agent = {
          provider: agent.provider,
          providerSessionId: agent.providerSessionId,
          title: agent.title,
          project: agent.project
        }
      }
      return leaf
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
      : salvage
        ? (first ?? second)
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
    ) {
      if (salvage) continue
      return null
    }
    const previousPanes = new Set(panes)
    const layout = tree(tab.layout, 0)
    if (!layout) {
      if (salvage) continue
      return null
    }
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
  const pinned = Array.isArray(value.pinned)
    ? [...new Set(value.pinned.filter((key): key is string => string(key, 8192)))].slice(0, 256)
    : []
  return {
    tabs,
    activeTabId:
      isTerminalId(value.activeTabId) && ids.has(value.activeTabId)
        ? value.activeTabId
        : (tabs[0]?.id ?? null),
    ...(pinned.length ? { pinned } : {})
  }
}
