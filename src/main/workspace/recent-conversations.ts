import { isAbsolute } from 'node:path'
import { isPlainObject } from '../../shared/plain-object'
import {
  conversationKey,
  RECENT_CONVERSATION_MS,
  type RecentConversation
} from '../../shared/recent-conversation'
import type { PaneLeaf } from '../../shared/terminal-workspace-api'

function key(record: RecentConversation): string {
  return conversationKey(record) ?? ''
}

function path(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === 'string' &&
      value.length <= 4096 &&
      !value.includes('\0') &&
      isAbsolute(value))
  )
}

function text(value: unknown): value is string | null {
  return (
    value === null || (typeof value === 'string' && value.length <= 1024 && !value.includes('\0'))
  )
}

export function parseRecentConversations(value: unknown): RecentConversation[] {
  if (!Array.isArray(value)) return []
  const records: RecentConversation[] = []
  for (const item of value) {
    if (!isPlainObject(item)) continue
    const { provider, providerSessionId, cwd, project, title, branch, closedAt } = item
    if (
      (provider !== 'hatfield' && provider !== 'claude') ||
      typeof providerSessionId !== 'string' ||
      !providerSessionId ||
      providerSessionId.length > 128 ||
      !path(cwd) ||
      !path(project) ||
      !text(title) ||
      !text(branch) ||
      typeof closedAt !== 'number' ||
      !Number.isSafeInteger(closedAt)
    )
      continue
    records.push({ provider, providerSessionId, cwd, project, title, branch, closedAt })
  }
  return updateRecentConversations(records, [], [], Date.now())
}

export function updateRecentConversations(
  history: RecentConversation[],
  before: PaneLeaf[],
  after: PaneLeaf[],
  now: number
): RecentConversation[] {
  const open = new Set(
    after.map((leaf) => leaf.agent && conversationKey({ ...leaf.agent, cwd: leaf.cwd }))
  )
  const records = new Map<string, RecentConversation>()
  for (const record of history) {
    const id = key(record)
    if (
      record.closedAt > now - RECENT_CONVERSATION_MS &&
      record.closedAt <= now &&
      (records.get(id)?.closedAt ?? 0) <= record.closedAt
    )
      records.set(id, record)
  }
  for (const { agent, cwd } of before) {
    if (!agent?.providerSessionId) continue
    const record = {
      ...agent,
      providerSessionId: agent.providerSessionId,
      cwd,
      branch: agent.branch ?? null,
      closedAt: now
    }
    const id = key(record)
    if (!open.has(id)) records.set(id, record)
  }
  return [...records.values()].toSorted((a, b) => b.closedAt - a.closedAt)
}
