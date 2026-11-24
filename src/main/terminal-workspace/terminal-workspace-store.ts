import { app, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentSession } from '../../shared/agent-api'
import {
  TERMINAL_WORKSPACE_CHANNELS,
  type PaneLayout,
  type SavedConversation,
  type TerminalLayout,
  type TerminalWorkspace
} from '../../shared/terminal-workspace-api'
import { writeFileAtomic } from '../files/atomic-write'
import { terminalSessions } from '../terminal/terminal-sessions'
import { worktreeStore } from '../git/worktree-store'
import {
  EMPTY_TERMINAL_WORKSPACE,
  parseTerminalWorkspace,
  RECENT_MS,
  TERMINAL_WORKSPACE_VERSION
} from './terminal-workspace-document'

export function sameConversation(
  a: SavedConversation | AgentSession,
  b: SavedConversation | AgentSession
): boolean {
  return (
    a.id === b.id ||
    (a.provider === b.provider &&
      a.providerSessionId !== null &&
      a.providerSessionId === b.providerSessionId &&
      (a.provider === 'claude' || a.cwd === b.cwd))
  )
}

class TerminalWorkspaceStore {
  private state = EMPTY_TERMINAL_WORKSPACE
  private loaded: Promise<void> | undefined
  private writing = Promise.resolve()
  private previous = ''
  private layout: TerminalLayout | undefined
  private live: AgentSession[] = []
  private bound = new Map<string, string>()
  private retired = new Set<string>()
  private frozen = false
  private generation = 0

  private file() {
    return join(app.getPath('userData'), 'terminal-workspace.json')
  }

  async view(): Promise<TerminalWorkspace> {
    this.loaded ??= readFile(this.file(), 'utf8')
      .then((text) => {
        this.state = parseTerminalWorkspace(JSON.parse(text))
      })
      .catch(() => undefined)
    await this.loaded
    return this.state
  }

  freeze(): Promise<void> {
    this.frozen = true
    this.generation++
    return this.writing
  }

  thaw(): void {
    if (!this.frozen) return
    this.frozen = false
    this.layout = undefined
    this.live = []
    this.bound.clear()
    this.retired.clear()
  }

  async checkpoint(owner: WebContents, layout: TerminalLayout): Promise<void> {
    const generation = this.generation
    await this.view()
    if (this.frozen || this.generation !== generation || owner.isDestroyed()) return
    this.layout = layout
    return this.commit(owner)
  }

  async observe(owner: WebContents, live: AgentSession[]): Promise<void> {
    const generation = this.generation
    await this.view()
    if (this.frozen || this.generation !== generation || owner.isDestroyed()) return
    for (const previous of this.live) {
      if (live.some((session) => session.id === previous.id)) continue
      this.bound.delete(previous.id)
      if (!terminalSessions.directory(owner, previous.terminalId))
        this.retired.add(previous.terminalId)
    }
    this.live = live
    return this.commit(owner)
  }

  async forget(owner: WebContents, id: string): Promise<void> {
    await this.view()
    if (this.frozen) return
    this.state = {
      ...this.state,
      conversations: this.state.conversations.filter(
        (item) => item.id !== id || item.closedAt === null
      )
    }
    return this.commit(owner)
  }

  private commit(owner: WebContents): Promise<void> {
    const now = Date.now()
    const open = new Set<string>()
    const history = new Map(this.state.conversations.map((session) => [session.id, session]))
    const remembered = new Map<string, string>()
    for (const live of this.live) {
      const bound = history.get(this.bound.get(live.id) ?? live.id)
      const existing =
        live.providerSessionId === null ||
        bound?.providerSessionId === null ||
        bound?.providerSessionId === live.providerSessionId
          ? bound
          : undefined
      const matching =
        existing ??
        [...history.values()].find(
          (item) => item.providerSessionId !== null && sameConversation(item, { ...live, id: '' })
        )
      const id = matching?.id ?? (bound ? randomUUID() : live.id)
      const project = worktreeStore.view().find((entry) => entry.folder === live.project)
      const branch =
        project?.status === 'git' && live.worktree
          ? (project.worktrees.find((tree) => tree.path === live.worktree)?.branch ??
            matching?.branch ??
            null)
          : null
      const { provider, providerSessionId, title, cwd, worktree, process, activity, updatedAt } =
        live
      history.set(id, {
        id,
        provider,
        providerSessionId,
        title,
        project: live.project,
        worktree,
        cwd,
        process,
        activity,
        updatedAt,
        branch,
        closedAt: null
      })
      remembered.set(live.id, id)
      this.bound.set(live.id, id)
      open.add(id)
    }
    const placed = new Set<string>()
    const paneTree = (tree: PaneLayout): PaneLayout | null => {
      if (tree.kind === 'split') {
        const first = paneTree(tree.first)
        const second = paneTree(tree.second)
        return first && second ? { ...tree, first, second } : (first ?? second)
      }
      const { id, terminalId, conversation } = tree
      const candidates = this.live.filter(
        (session) => terminalId && session.terminalId === terminalId
      )
      const live =
        candidates.findLast((session) => session.process === 'running') ?? candidates.at(-1)
      const key = (live && remembered.get(live.id)) ?? conversation
      if (terminalId && this.retired.has(terminalId) && !live) return null
      const valid = key && !placed.has(key) ? key : null
      if (valid) {
        placed.add(valid)
        open.add(valid)
      }
      return { kind: 'pane', id, conversation: valid }
    }
    const source = this.layout ?? this.state.layout
    const tabs = source.tabs.flatMap((tab) => {
      const layout = paneTree(tab.layout)
      return layout ? [{ ...tab, layout }] : []
    })
    const layout = {
      tabs,
      activeTabId: tabs.some((tab) => tab.id === source.activeTabId)
        ? source.activeTabId
        : (tabs[0]?.id ?? null)
    }
    const conversations = [...history.values()]
      .map((item) => ({
        ...item,
        closedAt: open.has(item.id) ? null : (item.closedAt ?? now)
      }))
      .filter(
        (item) =>
          item.closedAt === null ||
          (item.providerSessionId !== null && item.closedAt >= now - RECENT_MS)
      )
    this.state = { layout, conversations }
    const serialized = `${JSON.stringify({ version: TERMINAL_WORKSPACE_VERSION, ...this.state })}\n`
    if (serialized === this.previous) return this.writing
    this.previous = serialized
    if (!owner.isDestroyed()) owner.send(TERMINAL_WORKSPACE_CHANNELS.history, conversations)
    this.writing = this.writing
      .catch(() => undefined)
      .then(() => writeFileAtomic(this.file(), serialized))
      .catch((error: unknown) => {
        if (this.previous === serialized) this.previous = ''
        throw error
      })
    return this.writing
  }
}

export const terminalWorkspaceStore = new TerminalWorkspaceStore()
