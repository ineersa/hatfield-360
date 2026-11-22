import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import type {
  AgentNotification,
  AgentSession,
  AgentSnapshot,
  AgentProfile,
  AgentProvider
} from '../../shared/agent-api'
import { terminalSessions } from '../terminal/terminal-sessions'
import { AgentNotificationPolicy } from './agent-notifications'
import { agentStatusServer } from './status-server'

const records = new Map<string, { owner: WebContents; session: AgentSession }>()
const trackedOwners = new WeakSet<WebContents>()
const launches = new Map<
  string,
  { owner: WebContents; session: AgentSession; policy: AgentNotificationPolicy }
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
  agentStatusServer.subscribe((change) => {
    if (change.kind !== 'event' && change.kind !== 'revoked') return
    const launch = launches.get(change.launchId)
    if (!launch) return
    const { owner, session, policy } = launch
    if (change.kind === 'revoked') launches.delete(change.launchId)
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
    const turn = trusted?.actors.get('main')?.turn
    const waits =
      trusted && !trusted.ended
        ? [...trusted.actors.values()].flatMap((actor) => [...(actor.turn?.waits.values() ?? [])])
        : []
    if (trusted) session.providerSessionId = trusted.id
    const live = trusted && !trusted.ended ? trusted : undefined
    const working = (value: typeof turn) => value?.activity === 'working' && value.waits.size === 0
    session.runningChildren = live?.capabilities.includes('actors')
      ? [...live.actors].filter(([id, actor]) => id !== 'main' && working(actor.turn)).length
      : null
    session.runningScripts = live?.capabilities.includes('scripts') ? live.scripts.size : null
    const mainWorking = live && working(turn)
    session.activity =
      mainWorking || session.runningChildren || session.runningScripts
        ? 'working'
        : live && turn
          ? 'idle'
          : 'unknown'
    session.tool = mainWorking ? (turn?.tool ?? null) : null
    session.wait = waits[0]?.reason ?? null
    if (trusted) session.outcome = turn?.outcome ?? null
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
    const session: AgentSession = {
      id: randomUUID(),
      terminalId,
      provider,
      providerSessionId: null,
      project,
      cwd: request.cwd,
      process: 'running',
      activity: 'unknown',
      runningChildren: null,
      runningScripts: null,
      tool: null,
      wait: null,
      outcome: null,
      updatedAt: Date.now()
    }
    if (!trackedOwners.has(owner)) {
      trackedOwners.add(owner)
      owner.once('destroyed', () => {
        for (const [id, record] of records) if (record.owner === owner) records.delete(id)
      })
    }
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
          Object.assign(session, {
            process: 'exited',
            activity: 'unknown',
            runningChildren: null,
            runningScripts: null,
            tool: null,
            wait: null,
            updatedAt: Date.now()
          })
          changed(owner)
        }
      })
      records.set(session.id, { owner, session })
      changed(owner)
      return terminal
    } catch {
      release()
      throw new Error('Could not start the agent. Check the agent executable in Settings.')
    }
  }
}
