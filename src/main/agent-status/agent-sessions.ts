import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { isPathInside } from '../files/path-containment'
import type { WebContents } from 'electron'
import type {
  AgentNotification,
  AgentSession,
  AgentSnapshot,
  AgentProfile,
  AgentProvider
} from '../../shared/agent-api'
import { worktreeStore } from '../git/worktree-store'
import { workspaceStore } from '../workspace/workspace-store'
import { UnsupportedAgentShell } from '../terminal/agent-shell-command'
import { terminalSessions } from '../terminal/terminal-sessions'
import { AgentNotificationPolicy } from './agent-notifications'
import { agentStatusServer } from './status-server'

const records = new Map<
  string,
  { owner: WebContents; session: AgentSession; observedCwd: string | null }
>()
const trackedOwners = new WeakSet<WebContents>()
const manualHistory = new WeakMap<WebContents, string[]>()
const launches = new Map<
  string,
  { owner: WebContents; session: AgentSession; policy: AgentNotificationPolicy; manual?: true }
>()
let revision = 0

export function agentSnapshot(owner: WebContents): AgentSnapshot {
  return {
    revision,
    sessions: [...records.values()]
      .filter((record) => record.owner === owner)
      .map((record) => ({ ...record.session }))
  }
}

function recordSession(
  owner: WebContents,
  session: AgentSession,
  observedCwd: string | null = null
) {
  if (!trackedOwners.has(owner)) {
    trackedOwners.add(owner)
    owner.once('destroyed', () => {
      for (const [id, record] of records) if (record.owner === owner) records.delete(id)
    })
  }
  records.set(session.id, { owner, session, observedCwd })
}

function newSession(
  terminalId: string,
  provider: AgentProvider,
  cwd: string,
  project: string | null
): AgentSession {
  return {
    id: randomUUID(),
    terminalId,
    provider,
    providerSessionId: null,
    title: null,
    project,
    worktree: project !== null && project !== cwd ? cwd : null,
    cwd,
    process: 'running',
    activity: 'unknown',
    runningChildren: null,
    runningScripts: null,
    tool: null,
    wait: null,
    outcome: null,
    updatedAt: Date.now()
  }
}

async function placementRoots() {
  const folders = (await workspaceStore.view()).folders.filter(
    (folder) => folder.kind === 'project' && !folder.missing
  )
  const projects = new Set(folders.map(({ path }) => path))
  const candidates: { path: string; project: string; worktree: string | null }[] = folders.map(
    ({ path }) => ({ path, project: path, worktree: null })
  )
  for (const entry of worktreeStore.view()) {
    if (entry.status !== 'git' || !projects.has(entry.folder)) continue
    for (const tree of entry.worktrees) {
      if (!tree.prunable && !tree.project)
        candidates.push({ path: tree.path, project: entry.folder, worktree: tree.path })
    }
  }
  const canonical = await Promise.all(
    candidates.map(async ({ path, project, worktree }) => {
      const root = await realpath(path).catch(() => null)
      return { root, project, worktree }
    })
  )
  return canonical.toSorted((a, b) => (b.root?.length ?? 0) - (a.root?.length ?? 0))
}

export function trackAgentSessions(
  publish: (owner: WebContents) => void,
  notify: (
    owner: WebContents,
    notice: Omit<AgentNotification, 'ownerWindowFocusedAndVisible'>
  ) => void
) {
  const changed = (owner: WebContents) => {
    revision++
    if (!owner.isDestroyed()) publish(owner)
  }
  let refreshPending = false
  let refreshing = false
  const refreshPlacements = async () => {
    refreshPending = true
    if (refreshing) return
    refreshing = true
    try {
      while (refreshPending) {
        refreshPending = false
        const observed = [...records.values()].filter((record) => record.observedCwd !== null)
        if (!observed.length) continue
        const roots = await placementRoots().catch(() => null)
        if (!roots || refreshPending) continue
        const owners = new Set<WebContents>()
        for (const { owner, session, observedCwd } of observed) {
          if (observedCwd === null || !records.has(session.id)) continue
          const match = roots.find(({ root }) => root !== null && isPathInside(observedCwd, root))
          const project = match?.project ?? null
          const worktree = match?.worktree ?? null
          if (session.project === project && session.worktree === worktree) continue
          Object.assign(session, { project, worktree })
          owners.add(owner)
        }
        for (const owner of owners) changed(owner)
      }
    } finally {
      refreshing = false
    }
  }
  worktreeStore.onChange(() => void refreshPlacements())
  workspaceStore.onChange(() => void refreshPlacements())
  terminalSessions.onPaneClosed((owner, terminalId) => {
    const removed = new Set<string>()
    for (const [id, record] of records) {
      if (record.owner !== owner || record.session.terminalId !== terminalId) continue
      records.delete(id)
      removed.add(id)
    }
    if (!removed.size) return
    const history = manualHistory.get(owner)
    if (history)
      manualHistory.set(
        owner,
        history.filter((id) => !removed.has(id))
      )
    changed(owner)
  })
  agentStatusServer.subscribe((change) => {
    if (change.kind === 'manual-registered') {
      const placement = terminalSessions.manualPlacement(change.terminalId)
      if (!placement) return
      const { owner } = placement
      const session = newSession(
        change.terminalId,
        change.provider,
        change.cwd ?? placement.cwd,
        change.cwd === null ? placement.project : null
      )
      launches.set(change.launchId, {
        owner,
        session,
        policy: new AgentNotificationPolicy(),
        manual: true
      })
      recordSession(owner, session, change.cwd)
      changed(owner)
      if (change.cwd !== null) void refreshPlacements()
      return
    }
    if (change.kind === 'manual-ended') {
      const launch = launches.get(change.launchId)
      launches.delete(change.launchId)
      if (!launch || !records.has(launch.session.id)) return
      const { owner, session } = launch
      if (change.exited) {
        records.delete(session.id)
        changed(owner)
        return
      }
      Object.assign(session, {
        process: 'unknown',
        activity: 'unknown',
        runningChildren: null,
        runningScripts: null,
        tool: null,
        wait: null,
        updatedAt: Date.now()
      })
      const history = manualHistory.get(owner) ?? []
      history.push(session.id)
      if (history.length > 32) {
        const oldest = history.shift()
        if (oldest) records.delete(oldest)
      }
      manualHistory.set(owner, history)
      changed(owner)
      return
    }
    if (change.kind !== 'event' && change.kind !== 'revoked') return
    const launch = launches.get(change.launchId)
    if (!launch) return
    const { owner, session, policy } = launch
    if (change.kind === 'revoked') {
      if (launch.manual) return
      launches.delete(change.launchId)
    }
    const reported = agentStatusServer
      .snapshot()
      .find((entry) => entry.launchId === change.launchId)?.session
    const trusted = reported?.provider === session.provider ? reported : undefined
    if (change.kind === 'event') {
      if (trusted && !owner.isDestroyed()) {
        for (const message of policy.accept(change.event, trusted)) {
          notify(owner, {
            provider: session.provider,
            terminalId: session.terminalId,
            providerSessionId: trusted.id,
            message
          })
        }
      }
      if (change.event.kind === 'notification') return
    }
    if (trusted) {
      session.providerSessionId = trusted.id
      session.title = trusted.title
    }
    const live = trusted?.telemetry
    const status = live?.turn?.status
    session.runningChildren = live?.activeSubagents ?? null
    session.runningScripts = live?.backgroundScripts ?? null
    session.activity =
      status === 'working' || (live?.activeSubagents ?? 0) > 0
        ? 'working'
        : (status === 'completed' && live?.activeSubagents === 0) ||
            status === 'failed' ||
            status === 'cancelled'
          ? 'idle'
          : 'unknown'
    session.tool = status === 'working' ? (live?.tool ?? null) : null
    session.wait = live?.attention?.reason ?? null
    if (live) session.outcome = status && status !== 'working' ? status : null
    session.updatedAt = Date.now()
    if (records.has(session.id)) changed(owner)
  })
  return async (
    owner: WebContents,
    provider: AgentProvider,
    profile: AgentProfile,
    project: string | null,
    request: { cwd: string; cols: number; rows: number }
  ) => {
    if (process.platform === 'win32' && /\.(cmd|bat|ps1)[. ]*$/i.test(profile.executable)) {
      throw new Error(
        'Windows agent profiles require a native .exe. In Settings, choose node.exe with the script path in its arguments instead of a command or PowerShell shim.'
      )
    }
    const terminalId = randomUUID()
    const endpoint = await agentStatusServer.start().catch(() => undefined)
    const credential = endpoint
      ? agentStatusServer.registerLaunch({ terminalId, cwd: request.cwd })
      : undefined
    const session = newSession(terminalId, provider, request.cwd, project)
    const policy = new AgentNotificationPolicy()
    if (credential) launches.set(credential.launchId, { owner, session, policy })
    const release = () => {
      if (!credential) return
      launches.delete(credential.launchId)
      agentStatusServer.markExited(credential.launchId)
      agentStatusServer.revokeLaunch(credential.launchId)
    }
    try {
      const terminal = await terminalSessions.spawn(owner, request, {
        id: terminalId,
        project,
        ...profile,
        env: credential
          ? {
              H360_STATUS_ENDPOINT: credential.endpoint,
              H360_STATUS_TOKEN: credential.token,
              H360_STATUS_LAUNCH_ID: credential.launchId
            }
          : {},
        onClosing: () => policy.beginClosing(),
        onExit: () => {
          release()
          session.process = 'exited'
          if (records.delete(session.id)) changed(owner)
        }
      })
      if (session.process !== 'exited') {
        recordSession(owner, session)
        changed(owner)
      }
      return terminal
    } catch (error) {
      release()
      if (error instanceof UnsupportedAgentShell) throw error
      throw new Error('Could not start the agent. Check the agent executable in Settings.', {
        cause: error
      })
    }
  }
}
