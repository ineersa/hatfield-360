import { app, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentSession } from '../../shared/agent-api'
import {
  TERMINAL_WORKSPACE_CHANNELS,
  TERMINAL_WORKSPACE_RECENT_MS,
  sameConversation,
  type PaneLayout,
  type TerminalLayout,
  type TerminalWorkspace
} from '../../shared/terminal-workspace-api'
import { writeFileAtomic } from '../files/atomic-write'
import { terminalSessions } from '../terminal/terminal-sessions'
import { worktreeStore } from '../git/worktree-store'
import {
  EMPTY_TERMINAL_WORKSPACE,
  parseTerminalWorkspace,
  isWritableTerminalWorkspace,
  TERMINAL_WORKSPACE_VERSION
} from './terminal-workspace-document'

class TerminalWorkspaceStore {
  private state = EMPTY_TERMINAL_WORKSPACE
  private loaded: Promise<void> | undefined
  private writing: Promise<void> | undefined
  private pending: string | undefined
  private writable = true
  private previousHistory = ''
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
        const document: unknown = JSON.parse(text)
        const parsed = parseTerminalWorkspace(document)
        if (parsed) this.state = parsed
        this.writable = parsed !== null && isWritableTerminalWorkspace(document, parsed)
      })
      .catch((error: unknown) => {
        this.writable =
          typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
      })
    await this.loaded
    return this.state
  }

  freeze(): Promise<void> {
    this.frozen = true
    this.generation++
    return this.writing ?? Promise.resolve()
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
      const matching =
        [...history.values()].find((item) => sameConversation(item, live)) ??
        (bound?.providerSessionId === null || live.providerSessionId === null ? bound : undefined)
      if (bound?.providerSessionId === null && matching && bound.id !== matching.id)
        history.delete(bound.id)
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
      const key = terminalId ? live && remembered.get(live.id) : conversation
      if (terminalId && this.retired.has(terminalId) && !live) return null
      const valid = key && !placed.has(key) ? key : null
      if (valid) {
        placed.add(valid)
        open.add(valid)
      }
      let layout: PaneLayout = { kind: 'pane', id, conversation: valid }
      for (const candidate of candidates) {
        const extra = remembered.get(candidate.id)
        if (!extra || placed.has(extra) || candidate.process !== 'running') continue
        placed.add(extra)
        open.add(extra)
        layout = {
          kind: 'split',
          direction: 'horizontal',
          ratio: 0.5,
          first: layout,
          second: { kind: 'pane', id: extra, conversation: extra }
        }
      }
      return layout
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
          (item.providerSessionId !== null && item.closedAt >= now - TERMINAL_WORKSPACE_RECENT_MS)
      )
    this.state = { layout, conversations }
    const serialized = `${JSON.stringify({ version: TERMINAL_WORKSPACE_VERSION, ...this.state })}\n`
    if (serialized === this.previous) return this.writing ?? Promise.resolve()
    this.previous = serialized
    const historyText = JSON.stringify(conversations)
    if (historyText !== this.previousHistory && !owner.isDestroyed()) {
      this.previousHistory = historyText
      owner.send(TERMINAL_WORKSPACE_CHANNELS.history, conversations)
    }
    if (!this.writable) return Promise.resolve()
    this.pending = serialized
    this.writing ??= this.flush().finally(() => {
      this.writing = undefined
    })
    return this.writing
  }

  private async flush(): Promise<void> {
    while (this.pending !== undefined) {
      const next = this.pending
      this.pending = undefined
      try {
        await writeFileAtomic(this.file(), next)
      } catch (error) {
        if (this.pending === undefined) {
          this.previous = ''
          throw error
        }
      }
    }
  }
}

export const terminalWorkspaceStore = new TerminalWorkspaceStore()
