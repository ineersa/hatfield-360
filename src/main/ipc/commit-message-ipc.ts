import { app } from 'electron'
import { homedir } from 'node:os'
import { COMMIT_MESSAGE_CHANNELS, type CommitMessageOutcome } from '../../shared/commit-message-api'
import { isPlainObject } from '../../shared/plain-object'
import type { CommitMessageProvider, Settings } from '../../shared/settings-api'
import { writeCommitMessage } from '../chat/commit-message-agent'
import {
  agentScriptOverridden,
  type ChatAgentCommand,
  chatAgentCommand,
  resolveClaude
} from '../chat/chat-agent-launch'
import { fileRoots } from '../files/file-roots'
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
  claude: async (values, cwd) => {
    const claude = agentScriptOverridden()
      ? 'claude'
      : await resolveClaude(values['agents.claude'], cwd)
    return chatAgentCommand(claude, app.getVersion())
  }
}

/** The chosen provider's agent command, started in the workspace's first folder. */
async function agentCommand(values: Settings): Promise<{ command: ChatAgentCommand; cwd: string }> {
  const cwd = (await fileRoots.current())[0]?.path ?? homedir()
  return { command: await LAUNCHES[values['git.commitMessage.provider']](values, cwd), cwd }
}

/** What went wrong, with how to fix a missing login. */
function failure(error: unknown): CommitMessageOutcome {
  const text = message(error)
  const hint = /\b(auth\w*|log ?in|credentials?|401)\b/i.test(text)
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
  const { root } = await workingTree(request.root)
  const context = await commitMessageContext(root, { paths: request.paths, amend: request.amend })
  if (context.files.length === 0 && context.amended === null)
    return { ok: false, output: 'The checked files have no changes to describe.' }
  const { values } = await settingsStore.view()
  const controller = new AbortController()
  running.get(sender.id)?.abort()
  running.set(sender.id, controller)
  try {
    const reply = await writeCommitMessage(
      await agentCommand(values),
      {
        prompt: commitMessagePrompt(context, values['git.commitMessage.instructions']),
        model: values['git.commitMessage.model'],
        effort: values['git.commitMessage.effort'],
        diff: (path) => contextFileDiff(root, context, path)
      },
      controller.signal
    )
    if (reply.stopReason === 'cancelled' || controller.signal.aborted)
      return { ok: false, output: '', cancelled: true }
    const text = replyMessage(reply.text)
    if (reply.stopReason !== 'end_turn')
      return { ok: false, output: `The agent stopped (${reply.stopReason}) before it finished.` }
    return text === ''
      ? { ok: false, output: 'The agent answered without a message. Try again.' }
      : { ok: true, message: text }
  } catch (error) {
    return controller.signal.aborted ? { ok: false, output: '', cancelled: true } : failure(error)
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
