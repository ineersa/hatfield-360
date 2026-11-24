import { acceptsResumeArguments } from './resume-arguments'
import type { WebContents } from 'electron'
import { agentSnapshot, type trackAgentSessions } from '../agent-status/agent-sessions'
import { existingDirectory } from '../ipc/terminal-ipc'
import { settingsStore } from '../settings/settings-store'
import { terminalSessions } from '../terminal/terminal-sessions'
import type {
  ResumeFailure,
  ResumeResult,
  SavedConversation
} from '../../shared/terminal-workspace-api'
import { sameConversation } from '../../shared/terminal-workspace-api'

const CONFIRMATION_LIMIT_MS = 30_000

function failure(reason: string, detail: string, settings = false): { failure: ResumeFailure } {
  return { failure: { reason, detail, settings } }
}

export function resumeConversations(launch: ReturnType<typeof trackAgentSessions>) {
  const pending = new Map<string, Promise<ResumeResult>>()
  return (
    owner: WebContents,
    saved: SavedConversation,
    size: { cols: number; rows: number },
    signal: AbortSignal
  ): Promise<ResumeResult> => {
    const { provider, providerSessionId, cwd } = saved
    const id = providerSessionId ?? ''
    if (!id)
      return Promise.resolve(
        failure(
          'no conversation ID',
          'The provider did not report a conversation ID before the app closed.'
        )
      )
    if (
      !(
        provider === 'hatfield' ? /^[0-9]+$/ : /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
      ).test(id)
    ) {
      return Promise.resolve(
        failure(
          'unsupported conversation ID',
          'The provider did not report a resumable conversation ID.'
        )
      )
    }
    const key = JSON.stringify([owner.id, provider, provider === 'hatfield' ? cwd : null, id])
    const existing = pending.get(key)
    if (existing)
      return Promise.resolve(
        failure('already resuming', 'This conversation is already resuming in another pane.')
      )
    const cancelled = failure('resume cancelled', 'The resume pane was closed.')
    const resume = async (): Promise<ResumeResult> => {
      const live = agentSnapshot(owner).sessions.find((session) => sameConversation(session, saved))
      if (live) return failure('already open', 'This conversation is already open in another pane.')
      if (!(await existingDirectory(cwd).catch(() => null))) {
        return failure(
          saved.worktree ? 'worktree missing' : 'folder missing',
          `The folder ${cwd} no longer exists.`
        )
      }
      const settings = await settingsStore.view()
      const profile = settings.values[`agents.${provider}`]
      if (!settings.editable || settings.notice?.message?.includes(`agents.${provider}`)) {
        return failure(
          'invalid command settings',
          'Fix the configured provider command in Settings, then retry.',
          true
        )
      }
      if (!acceptsResumeArguments(provider, profile)) {
        return failure(
          'conflicting resume arguments',
          'Remove options that select, fork or prompt a conversation from the provider command in Settings.',
          true
        )
      }
      if (signal.aborted) return cancelled
      const args = provider === 'hatfield' ? [`--resume=${id}`] : ['--resume', id]
      type Confirmation = { ok: true } | { ok: false; response: { failure: ResumeFailure } }
      let settle: ((result: Confirmation) => void) | undefined
      const reported = new Promise<Confirmation>((resolve) => {
        settle = resolve
      })
      const report = (result: Confirmation) => settle?.(result)
      const abort = () => report({ ok: false, response: cancelled })
      signal.addEventListener('abort', abort, { once: true })
      const timer = setTimeout(
        () =>
          report({
            ok: false,
            response: failure(
              'session not confirmed',
              'The configured command did not report the requested conversation. Check the provider integration and retry.'
            )
          }),
        CONFIRMATION_LIMIT_MS
      )
      try {
        const terminal = await launch(
          owner,
          provider,
          { ...profile, args: [...profile.args, ...args] },
          saved.project,
          { ...size, cwd },
          {
            saved,
            signal,
            confirm: (reportedId) => {
              const match = reportedId === id
              report(
                match
                  ? { ok: true }
                  : {
                      ok: false,
                      response: failure(
                        'different conversation reported',
                        'The configured provider did not reopen the requested conversation.'
                      )
                    }
              )
              return match
            },
            exited: (exitCode) =>
              report({
                ok: false,
                response:
                  exitCode === 127
                    ? failure(
                        'executable not found',
                        `Could not find ${profile.executable}, the configured command.`,
                        true
                      )
                    : exitCode === 126
                      ? failure(
                          'executable could not run',
                          `Could not run ${profile.executable}, the configured command.`,
                          true
                        )
                      : failure(
                          'process exited',
                          `The configured provider exited with code ${exitCode} before confirming the conversation.`
                        )
              })
          }
        )
        const result = await reported
        if (result.ok && !signal.aborted) return { terminal }
        await terminalSessions.kill(owner, terminal.id)
        return { ...(result.ok ? cancelled : result.response), discardedTerminalId: terminal.id }
      } catch {
        if (signal.aborted) return cancelled
        return failure(
          'launch failed',
          'The provider process could not start. Check the configured command in Settings.',
          true
        )
      } finally {
        signal.removeEventListener('abort', abort)
        clearTimeout(timer)
      }
    }
    const operation = resume().finally(() => pending.delete(key))
    pending.set(key, operation)
    return operation
  }
}
