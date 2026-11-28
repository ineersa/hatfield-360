import { app } from 'electron'
import { COMMIT_MESSAGE_CHANNELS, type CommitMessageOutcome } from '../../shared/commit-message-api'
import { isPlainObject } from '../../shared/plain-object'
import type { CommitMessageProvider, Settings } from '../../shared/settings-api'
import { writeCommitMessage } from '../chat/commit-message-agent'
import { type ChatAgentCommand, claudeAgentCommand } from '../chat/chat-agent-launch'
import {
  commitMessageContext,
  commitMessagePrompt,
  contextFileDiff,
  replyMessage
} from '../git/commit-message-context'
import { settingsStore } from '../settings/settings-store'
import { workingTree } from './source-control-ipc'
import { handleTrusted } from './trusted-ipc'

/** The generation each window is running, by its webContents id: only that window may stop it. */
const running = new Map<number, AbortController>()

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Each provider's ACP agent command, from its launch profile in Settings. */
const LAUNCHES: Record<
  CommitMessageProvider,
  (values: Settings, cwd: string) => Promise<ChatAgentCommand>
> = {
  claude: (values, cwd) =>
    claudeAgentCommand(values['agents.claude'], cwd, app.getVersion(), app.getPath('userData'))
}

/** The chosen provider's agent command, started in the repository it writes for. */
async function agentCommand(
  values: Settings,
  cwd: string
): Promise<{ command: ChatAgentCommand; cwd: string }> {
  return { command: await LAUNCHES[values['git.commitMessage.provider']](values, cwd), cwd }
}

/** What went wrong, with how to fix a missing login. */
function failure(error: unknown): CommitMessageOutcome {
  const text = message(error)
  const hint =
    /\b(authenticat\w*|unauthori[sz]ed|not logged in|log ?in|\/login|credentials?|401)\b/i.test(
      text
    )
      ? '\n\nLog in to Claude Code: run `claude` in a terminal and use /login, then generate again.'
      : ''
  return { ok: false, output: `${text}${hint}` }
}

async function generate(
  sender: Electron.WebContents,
  request: unknown
): Promise<CommitMessageOutcome> {
  if (!isPlainObject(request) || typeof request.amend !== 'boolean')
    throw new Error('Invalid commit message request.')
  // Registered before anything is read, so a Stop that comes while git runs is not lost.
  const controller = new AbortController()
  running.get(sender.id)?.abort()
  running.set(sender.id, controller)
  const cancelled: CommitMessageOutcome = { ok: false, output: '', cancelled: true }
  try {
    const { root } = await workingTree(request.root)
    const context = await commitMessageContext(root, {
      paths: request.paths,
      amend: request.amend
    })
    if (controller.signal.aborted) return cancelled
    if (context.files.length === 0 && context.amended === null)
      return { ok: false, output: 'The checked files have no changes to describe.' }
    const { values } = await settingsStore.view()
    const command = await agentCommand(values, root)
    if (controller.signal.aborted) return cancelled
    const reply = await writeCommitMessage(
      command,
      {
        prompt: commitMessagePrompt(context, values['git.commitMessage.instructions']),
        model: values['git.commitMessage.model'],
        effort: values['git.commitMessage.effort'],
        diff: (path) => contextFileDiff(root, context, path)
      },
      controller.signal
    )
    if (reply.stopReason === 'cancelled' || controller.signal.aborted) return cancelled
    const text = replyMessage(reply.text)
    if (reply.stopReason !== 'end_turn')
      return { ok: false, output: `The agent stopped (${reply.stopReason}) before it finished.` }
    return text === ''
      ? { ok: false, output: 'The agent answered without a message. Try again.' }
      : { ok: true, message: text }
  } catch (error) {
    return controller.signal.aborted ? cancelled : failure(error)
  } finally {
    if (running.get(sender.id) === controller) running.delete(sender.id)
  }
}

export function registerCommitMessageIpc(): void {
  handleTrusted(COMMIT_MESSAGE_CHANNELS.generate, (event, request) =>
    generate(event.sender, request)
  )
  handleTrusted(COMMIT_MESSAGE_CHANNELS.cancel, (event) => {
    running.get(event.sender.id)?.abort()
  })
}

/** Stops every running generation, and so its agent, with the app. */
export function endCommitMessageAgents(): void {
  for (const controller of running.values()) controller.abort()
}
