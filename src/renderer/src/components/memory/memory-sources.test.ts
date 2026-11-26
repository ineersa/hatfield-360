import { describe, expect, it } from 'vitest'
import type { AgentSession } from '../../../../shared/agent-api'
import type { RecentConversation } from '../../../../shared/recent-conversation'
import { memorySource } from './memory-sources'

const PROJECT = '/work/app'
const WORKTREE = '/work/app-worktrees/issue-7'
const CLAUDE_ID = '0aff2325-55c9-487a-abfe-69bb4349d6ce'

function live(overrides: Partial<AgentSession>): AgentSession {
  return {
    id: 'launch-1',
    terminalId: 'terminal-1',
    provider: 'hatfield',
    providerSessionId: '3',
    title: null,
    project: PROJECT,
    worktree: null,
    cwd: PROJECT,
    process: 'running',
    activity: 'idle',
    runningChildren: 0,
    runningScripts: 0,
    tool: null,
    wait: null,
    outcome: null,
    schedules: null,
    trigger: null,
    updatedAt: 0,
    ...overrides
  }
}

function recent(overrides: Partial<RecentConversation>): RecentConversation {
  return {
    provider: 'hatfield',
    providerSessionId: '3',
    project: PROJECT,
    title: 'Status server',
    cwd: PROJECT,
    branch: null,
    lastModified: 0,
    ...overrides
  }
}

describe('memorySource', () => {
  it("opens a Hatfield session's running pane only in the project itself, not a worktree's same number", () => {
    const inWorktree = live({ terminalId: 'terminal-w', cwd: WORKTREE, worktree: WORKTREE })
    const inProject = live({ terminalId: 'terminal-p' })
    const hit = { provider: 'hatfield' as const, sessionId: '3' }
    expect(memorySource(hit, PROJECT, [inWorktree], [], new Map())).toEqual({
      kind: 'unknown',
      provider: 'hatfield'
    })
    expect(memorySource(hit, PROJECT, [inWorktree, inProject], [], new Map())).toEqual({
      kind: 'live',
      session: inProject
    })
  })

  it('prefers a running pane to Recent history and ignores exited panes', () => {
    const entry = recent({ provider: 'claude', providerSessionId: CLAUDE_ID })
    const exited = live({ provider: 'claude', providerSessionId: CLAUDE_ID, process: 'exited' })
    const running = live({ provider: 'claude', providerSessionId: CLAUDE_ID.toUpperCase() })
    const hit = { provider: 'claude' as const, sessionId: CLAUDE_ID }
    expect(memorySource(hit, PROJECT, [exited], [entry], new Map())).toEqual({
      kind: 'history',
      entry
    })
    expect(memorySource(hit, PROJECT, [exited, running], [entry], new Map())).toEqual({
      kind: 'live',
      session: running
    })
  })

  it('matches Hatfield history recorded under a symlinked project path', () => {
    const entry = recent({ resumeCwd: '/home/me/app', cwd: '/home/me/app' })
    const aliases = new Map([
      ['/home/me/app', '/work/app'],
      [PROJECT, '/work/app']
    ])
    expect(
      memorySource({ provider: 'hatfield', sessionId: '3' }, PROJECT, [], [entry], aliases)
    ).toEqual({ kind: 'history', entry })
  })

  it("never offers another project's Claude session or a source of unknown shape", () => {
    const elsewhere = recent({
      provider: 'claude',
      providerSessionId: CLAUDE_ID,
      project: '/work/other'
    })
    expect(
      memorySource(
        { provider: 'claude', sessionId: CLAUDE_ID },
        PROJECT,
        [],
        [elsewhere],
        new Map()
      )
    ).toEqual({ kind: 'unknown', provider: 'claude' })
    expect(
      memorySource({ provider: null, sessionId: 'run-7' }, PROJECT, [], [], new Map())
    ).toEqual({ kind: 'unknown', provider: null })
  })
})
