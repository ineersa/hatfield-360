import { app, type WebContents } from 'electron'
import { stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { CHAT_AGENT_CHANNELS, type ChatConfigId } from '../../shared/chat-agent-api'
import { fileRoots } from '../files/file-roots'
import { resolveInsideRoots } from '../files/path-containment'
import { settingsStore } from '../settings/settings-store'
import { workspaceStore } from '../workspace/workspace-store'
import { ChatAgentSession } from './chat-agent'
import { agentScriptOverridden, chatAgentCommand, resolveClaude } from './chat-agent-launch'
import { WorkspaceMapFile } from './workspace-map-file'

const isFile = (path: string): Promise<boolean> =>
  stat(path).then(
    (found) => found.isFile(),
    () => false
  )

/** The one workspace chat: started from the panel, ended by New chat, closing the panel or quitting. */
class ChatAgentHost {
  private current: { session: ChatAgentSession; cwd: string } | null = null
  /** Bumped by every start, so a start overtaken by a newer one ends its own session. */
  private generation = 0
  private readonly watched = new WeakSet<WebContents>()

  async start(owner: WebContents, requested: string | null): Promise<{ chatId: string }> {
    this.end()
    const generation = ++this.generation
    const roots = (await fileRoots.current()).map((root) => root.path)
    const folders = (await workspaceStore.view()).folders
      .filter((folder) => !folder.missing)
      .map((folder) => folder.path)
    const cwd = requested !== null && roots.includes(requested) ? requested : roots[0]
    if (cwd === undefined) throw new Error('Add a folder to the workspace to chat about it.')
    const mapFile = new WorkspaceMapFile(await workspaceStore.instructionsFile())
    const { values } = await settingsStore.view()
    const session = new ChatAgentSession(
      {
        command: async () =>
          chatAgentCommand(
            agentScriptOverridden() ? 'claude' : await resolveClaude(values['agents.claude'], cwd),
            app.getVersion()
          ),
        cwd,
        additionalDirectories: folders.filter((folder) => folder !== cwd),
        mapFile,
        preferred: { model: values['chat.model'], effort: values['chat.effort'] }
      },
      (event) => {
        if (!owner.isDestroyed()) owner.send(CHAT_AGENT_CHANNELS.event, event)
      },
      (configId, value) => {
        const key = configId === 'model' ? 'chat.model' : 'chat.effort'
        settingsStore.update(key, value).catch((error: unknown) => {
          console.error('Saving the chat default failed:', error)
        })
      }
    )
    if (generation !== this.generation) {
      session.end()
      throw new Error('A newer chat was started.')
    }
    this.current = { session, cwd }
    if (!this.watched.has(owner)) {
      this.watched.add(owner)
      // Ends with the page, so a reload doesn't leave the agent running.
      owner.once('destroyed', () => this.end())
    }
    void session.open()
    return { chatId: session.id }
  }

  /** The running chat with this id; a stale id (an ended chat) is refused. */
  chat(chatId: string): ChatAgentSession {
    if (this.current?.session.id !== chatId) throw new Error('That chat has ended.')
    return this.current.session
  }

  end(chatId?: string): void {
    // An end without an id also cancels a start still on its way.
    if (chatId === undefined) this.generation++
    if (!this.current || (chatId !== undefined && this.current.session.id !== chatId)) return
    this.current.session.end()
    this.current = null
  }

  setConfig(chatId: string, configId: ChatConfigId, value: string): Promise<void> {
    return this.chat(chatId).setConfig(configId, value)
  }

  /** A reply's file paths, relative to the chat's folder or any workspace root, inside the roots. */
  async resolvePaths(chatId: string, paths: string[]): Promise<(string | null)[]> {
    const { cwd } = this.current?.session.id === chatId ? this.current : { cwd: null }
    const roots = (await fileRoots.current()).map((root) => root.path)
    const bases = [...(cwd ? [cwd] : []), ...roots]
    return Promise.all(
      paths.map(async (path) => {
        for (const candidate of isAbsolute(path) ? [path] : bases.map((base) => join(base, path))) {
          if (!(await isFile(candidate))) continue
          if ((await resolveInsideRoots(candidate, roots)) !== null) return candidate
        }
        return null
      })
    )
  }

  async mapFile(): Promise<string> {
    return new WorkspaceMapFile(await workspaceStore.instructionsFile()).ensure()
  }
}

export const chatAgentHost = new ChatAgentHost()
