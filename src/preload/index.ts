import { AGENT_CHANNELS, type AgentNotification, type AgentSnapshot } from '../shared/agent-api'
import { contextBridge, ipcRenderer } from 'electron'
import { CHAT_AGENT_CHANNELS, type ChatEvent } from '../shared/chat-agent-api'
import { type DesktopApi, IPC_CHANNELS } from '../shared/desktop-api'
import { EDITOR_CHANNELS } from '../shared/editor-api'
import { FILES_SESSION_CHANNELS } from '../shared/files-session-api'
import { FILE_TREE_CHANNELS } from '../shared/file-tree-api'
import { KEYBINDINGS_CHANNELS, type KeybindingsView } from '../shared/keybindings-api'
import { SEARCH_CHANNELS, type SearchEvent } from '../shared/search-api'
import { SEARCH_EVERYWHERE_CHANNELS } from '../shared/search-everywhere-api'
import { SETTINGS_CHANNELS, type SettingsView } from '../shared/settings-api'
import { SHELL_LAYOUT_CHANNELS } from '../shared/shell-layout-api'
import { BRANCH_CHANNELS } from '../shared/branch-api'
import { COMMIT_MESSAGE_CHANNELS } from '../shared/commit-message-api'
import { SOURCE_CONTROL_CHANNELS } from '../shared/source-control-api'
import { MEMORY_SEARCH_CHANNELS } from '../shared/memory-search-api'
import { LANGUAGE_SERVER_CHANNELS, type LanguageServerStatus } from '../shared/language-server-api'
import { TERMINAL_CHANNELS, type TerminalCommand, type TerminalExit } from '../shared/terminal-api'
import { type WorkspaceView, WORKSPACE_CHANNELS } from '../shared/workspace-api'
import { WEB_LINK_CHANNELS } from '../shared/web-link-api'
import { type ProjectWorktrees, WORKTREE_CHANNELS } from '../shared/worktree-api'

const desktopApi: DesktopApi = {
  startChat: (cwd) => ipcRenderer.invoke(CHAT_AGENT_CHANNELS.start, cwd),
  sendChatPrompt: (chatId, text) => ipcRenderer.invoke(CHAT_AGENT_CHANNELS.prompt, chatId, text),
  answerChatPermission: (chatId, requestId, optionId) =>
    ipcRenderer.invoke(CHAT_AGENT_CHANNELS.answerPermission, chatId, requestId, optionId),
  setChatConfig: (chatId, configId, value) =>
    ipcRenderer.invoke(CHAT_AGENT_CHANNELS.setConfig, chatId, configId, value),
  stopChat: (chatId) => ipcRenderer.invoke(CHAT_AGENT_CHANNELS.stop, chatId),
  endChat: (chatId) => ipcRenderer.invoke(CHAT_AGENT_CHANNELS.end, chatId),
  generateWorkspaceMap: (chatId) => ipcRenderer.invoke(CHAT_AGENT_CHANNELS.generateMap, chatId),
  workspaceMapFile: () => ipcRenderer.invoke(CHAT_AGENT_CHANNELS.mapFile),
  resolveChatPaths: (chatId, paths) =>
    ipcRenderer.invoke(CHAT_AGENT_CHANNELS.resolvePaths, chatId, paths),
  subscribeChatEvents: (callback) => {
    const listener = (_event: unknown, chatEvent: ChatEvent): void => callback(chatEvent)
    ipcRenderer.on(CHAT_AGENT_CHANNELS.event, listener)
    return () => ipcRenderer.removeListener(CHAT_AGENT_CHANNELS.event, listener)
  },
  launchAgent: (request) => ipcRenderer.invoke(AGENT_CHANNELS.launch, request),
  getRecentConversations: (generation) => ipcRenderer.invoke(AGENT_CHANNELS.recent, generation),
  getAgentSessions: () => ipcRenderer.invoke(AGENT_CHANNELS.get),
  searchMemory: (request) => ipcRenderer.invoke(MEMORY_SEARCH_CHANNELS.search, request),
  recallMemory: (project, id) => ipcRenderer.invoke(MEMORY_SEARCH_CHANNELS.recall, project, id),
  subscribeAgentNotifications: (callback) => {
    const listener = (_event: unknown, notice: AgentNotification): void => callback(notice)
    ipcRenderer.on(AGENT_CHANNELS.notification, listener)
    return () => ipcRenderer.removeListener(AGENT_CHANNELS.notification, listener)
  },
  subscribeAgentSessions: (callback) => {
    const listener = (_event: unknown, snapshot: AgentSnapshot): void => callback(snapshot)
    ipcRenderer.on(AGENT_CHANNELS.changed, listener)
    return () => ipcRenderer.removeListener(AGENT_CHANNELS.changed, listener)
  },
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getAppInfo),
  checkpointTerminals: (generation, layout) =>
    ipcRenderer.invoke(WORKSPACE_CHANNELS.checkpointTerminals, generation, layout),
  getWorkspace: () => ipcRenderer.invoke(WORKSPACE_CHANNELS.get),
  addWorkspaceFolder: () => ipcRenderer.invoke(WORKSPACE_CHANNELS.addFolder),
  removeWorkspaceFolder: (path) => ipcRenderer.invoke(WORKSPACE_CHANNELS.removeFolder, path),
  setWorkspaceFolderKind: (path, kind) =>
    ipcRenderer.invoke(WORKSPACE_CHANNELS.setFolderKind, path, kind),
  openWorkspaceFile: () => ipcRenderer.invoke(WORKSPACE_CHANNELS.openFile),
  openRecent: (target) => ipcRenderer.invoke(WORKSPACE_CHANNELS.openRecent, target),
  removeRecent: (target) => ipcRenderer.invoke(WORKSPACE_CHANNELS.removeRecent, target),
  subscribeWorkspace: (callback) => {
    const listener = (_event: unknown, workspace: WorkspaceView): void => callback(workspace)
    ipcRenderer.on(WORKSPACE_CHANNELS.changed, listener)
    return () => ipcRenderer.removeListener(WORKSPACE_CHANNELS.changed, listener)
  },
  pruneMissingWorktrees: (project, path) =>
    ipcRenderer.invoke(WORKTREE_CHANNELS.pruneMissing, project, path),
  getWorktrees: () => ipcRenderer.invoke(WORKTREE_CHANNELS.get),
  subscribeWorktrees: (callback) => {
    const listener = (_event: unknown, projects: ProjectWorktrees[]): void => callback(projects)
    ipcRenderer.on(WORKTREE_CHANNELS.changed, listener)
    return () => ipcRenderer.removeListener(WORKTREE_CHANNELS.changed, listener)
  },
  getSourceControlStatus: () => ipcRenderer.invoke(SOURCE_CONTROL_CHANNELS.status),
  commitChanges: (request) => ipcRenderer.invoke(SOURCE_CONTROL_CHANNELS.commit, request),
  getLastCommitMessage: (root) =>
    ipcRenderer.invoke(SOURCE_CONTROL_CHANNELS.lastCommitMessage, root),
  pushBranch: (root) => ipcRenderer.invoke(SOURCE_CONTROL_CHANNELS.push, root),
  pullBranch: (root) => ipcRenderer.invoke(SOURCE_CONTROL_CHANNELS.pull, root),
  rollbackChanges: (root, paths) =>
    ipcRenderer.invoke(SOURCE_CONTROL_CHANNELS.rollback, root, paths),
  fetchRemote: (root) => ipcRenderer.invoke(SOURCE_CONTROL_CHANNELS.fetch, root),
  addUntrackedFiles: (root, paths) =>
    ipcRenderer.invoke(SOURCE_CONTROL_CHANNELS.addUntracked, root, paths),
  ignoreUntrackedFile: (root, path) =>
    ipcRenderer.invoke(SOURCE_CONTROL_CHANNELS.ignoreUntracked, root, path),
  launchHunk: (request) => ipcRenderer.invoke(SOURCE_CONTROL_CHANNELS.launchHunk, request),
  abortGitOperation: (root, operation) =>
    ipcRenderer.invoke(SOURCE_CONTROL_CHANNELS.abortOperation, root, operation),
  cancelSourceControlAction: () => ipcRenderer.invoke(SOURCE_CONTROL_CHANNELS.cancel),
  generateCommitMessage: (request) => ipcRenderer.invoke(COMMIT_MESSAGE_CHANNELS.generate, request),
  cancelCommitMessage: () => ipcRenderer.invoke(COMMIT_MESSAGE_CHANNELS.cancel),
  listBranches: (root) => ipcRenderer.invoke(BRANCH_CHANNELS.list, root),
  previewSwitch: (root, branch) => ipcRenderer.invoke(BRANCH_CHANNELS.preview, root, branch),
  switchBranch: (root, branch) => ipcRenderer.invoke(BRANCH_CHANNELS.switch, root, branch),
  createBranch: (request) => ipcRenderer.invoke(BRANCH_CHANNELS.create, request),
  deleteBranch: (root, name, force) =>
    ipcRenderer.invoke(BRANCH_CHANNELS.delete, root, name, force),
  listDirectory: (path) => ipcRenderer.invoke(FILE_TREE_CHANNELS.list, path),
  watchDirectories: (paths) => ipcRenderer.invoke(FILE_TREE_CHANNELS.watch, paths),
  copyPath: (path, form, lines) =>
    ipcRenderer.invoke(FILE_TREE_CHANNELS.copyPath, path, form, lines),
  revealPath: (path) => ipcRenderer.invoke(FILE_TREE_CHANNELS.reveal, path),
  trashPaths: (paths) => ipcRenderer.invoke(FILE_TREE_CHANNELS.trash, paths),
  renamePath: (path, name) => ipcRenderer.invoke(FILE_TREE_CHANNELS.rename, path, name),
  createEntry: (folder, name, kind) =>
    ipcRenderer.invoke(FILE_TREE_CHANNELS.create, folder, name, kind),
  subscribeDirectoryChanges: (callback) => {
    const listener = (_event: unknown, paths: string[]): void => callback(paths)
    ipcRenderer.on(FILE_TREE_CHANNELS.changed, listener)
    return () => ipcRenderer.removeListener(FILE_TREE_CHANNELS.changed, listener)
  },
  startSearch: (id, query) => ipcRenderer.invoke(SEARCH_CHANNELS.start, id, query),
  cancelSearch: () => ipcRenderer.invoke(SEARCH_CHANNELS.cancel),
  findWorkspaceFiles: (query) => ipcRenderer.invoke(SEARCH_EVERYWHERE_CHANNELS.findFiles, query),
  findUnlistedPaths: (paths) => ipcRenderer.invoke(SEARCH_EVERYWHERE_CHANNELS.findUnlisted, paths),
  subscribeSearch: (callback) => {
    const listener = (_event: unknown, event: SearchEvent): void => callback(event)
    ipcRenderer.on(SEARCH_CHANNELS.event, listener)
    return () => ipcRenderer.removeListener(SEARCH_CHANNELS.event, listener)
  },
  readTextFile: (path) => ipcRenderer.invoke(EDITOR_CHANNELS.read, path),
  writeTextFile: (path, contents, base) =>
    ipcRenderer.invoke(EDITOR_CHANNELS.write, path, contents, base),
  releaseTextFile: (path) => ipcRenderer.invoke(EDITOR_CHANNELS.release, path),
  subscribeFileChanges: (callback) => {
    const listener = (_event: unknown, paths: string[]): void => callback(paths)
    ipcRenderer.on(EDITOR_CHANNELS.changed, listener)
    return () => ipcRenderer.removeListener(EDITOR_CHANNELS.changed, listener)
  },
  subscribeSaveCommand: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on(EDITOR_CHANNELS.save, listener)
    return () => ipcRenderer.removeListener(EDITOR_CHANNELS.save, listener)
  },
  setUnsavedChanges: (unsaved) => ipcRenderer.invoke(EDITOR_CHANNELS.setUnsaved, unsaved),
  subscribeCloseRequest: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on(EDITOR_CHANNELS.closeRequested, listener)
    return () => ipcRenderer.removeListener(EDITOR_CHANNELS.closeRequested, listener)
  },
  answerCloseRequest: (proceed) => ipcRenderer.invoke(EDITOR_CHANNELS.answerClose, proceed),
  getFilesSession: (workspace) => ipcRenderer.invoke(FILES_SESSION_CHANNELS.get, workspace),
  saveFilesSession: (workspace, session) =>
    ipcRenderer.invoke(FILES_SESSION_CHANNELS.save, workspace, session),
  getSettings: () => ipcRenderer.invoke(SETTINGS_CHANNELS.get),
  updateSetting: (key, value) => ipcRenderer.invoke(SETTINGS_CHANNELS.update, key, value),
  openSettingsFile: () => ipcRenderer.invoke(SETTINGS_CHANNELS.openFile),
  subscribeSettings: (callback) => {
    const listener = (_event: unknown, settings: SettingsView): void => callback(settings)
    ipcRenderer.on(SETTINGS_CHANNELS.changed, listener)
    return () => ipcRenderer.removeListener(SETTINGS_CHANNELS.changed, listener)
  },
  getKeybindings: () => ipcRenderer.invoke(KEYBINDINGS_CHANNELS.get),
  openKeybindingsFile: () => ipcRenderer.invoke(KEYBINDINGS_CHANNELS.openFile),
  subscribeKeybindings: (callback) => {
    const listener = (_event: unknown, view: KeybindingsView): void => callback(view)
    ipcRenderer.on(KEYBINDINGS_CHANNELS.changed, listener)
    return () => ipcRenderer.removeListener(KEYBINDINGS_CHANNELS.changed, listener)
  },
  subscribeShowKeybindingsFile: (callback) => {
    const listener = (_event: unknown, path: string): void => callback(path)
    ipcRenderer.on(KEYBINDINGS_CHANNELS.showFile, listener)
    return () => ipcRenderer.removeListener(KEYBINDINGS_CHANNELS.showFile, listener)
  },
  getShellLayout: () => ipcRenderer.invoke(SHELL_LAYOUT_CHANNELS.get),
  saveShellLayout: (layout) => ipcRenderer.invoke(SHELL_LAYOUT_CHANNELS.save, layout),
  spawnTerminal: (request) => ipcRenderer.invoke(TERMINAL_CHANNELS.spawn, request),
  writeTerminal: (id, data) => ipcRenderer.invoke(TERMINAL_CHANNELS.write, id, data),
  resizeTerminal: (id, cols, rows) => ipcRenderer.invoke(TERMINAL_CHANNELS.resize, id, cols, rows),
  killTerminal: (id) => ipcRenderer.invoke(TERMINAL_CHANNELS.kill, id),
  ackTerminalOutput: (id, bytes) => ipcRenderer.invoke(TERMINAL_CHANNELS.ack, id, bytes),
  openWebLink: (url) => ipcRenderer.invoke(WEB_LINK_CHANNELS.open, url),
  connectLanguageServer: (path, languageId) =>
    ipcRenderer.invoke(LANGUAGE_SERVER_CHANNELS.connect, path, languageId),
  sendLanguageServerMessage: (id, message) =>
    ipcRenderer.invoke(LANGUAGE_SERVER_CHANNELS.send, id, message),
  disconnectLanguageServer: (id) => ipcRenderer.invoke(LANGUAGE_SERVER_CHANNELS.disconnect, id),
  subscribeLanguageServerMessages: (callback) => {
    const listener = (_event: unknown, id: string, message: unknown): void => callback(id, message)
    ipcRenderer.on(LANGUAGE_SERVER_CHANNELS.message, listener)
    return () => ipcRenderer.removeListener(LANGUAGE_SERVER_CHANNELS.message, listener)
  },
  subscribeLanguageServerStatus: (callback) => {
    const listener = (_event: unknown, status: LanguageServerStatus): void => callback(status)
    ipcRenderer.on(LANGUAGE_SERVER_CHANNELS.status, listener)
    return () => ipcRenderer.removeListener(LANGUAGE_SERVER_CHANNELS.status, listener)
  },
  readTerminalClipboard: () => ipcRenderer.invoke(TERMINAL_CHANNELS.readClipboard),
  writeTerminalClipboard: (text) => ipcRenderer.invoke(TERMINAL_CHANNELS.writeClipboard, text),
  subscribeTerminalData: (callback) => {
    const listener = (_event: unknown, id: string, data: string): void => callback(id, data)
    ipcRenderer.on(TERMINAL_CHANNELS.data, listener)
    return () => ipcRenderer.removeListener(TERMINAL_CHANNELS.data, listener)
  },
  subscribeTerminalExit: (callback) => {
    const listener = (_event: unknown, exit: TerminalExit): void => callback(exit)
    ipcRenderer.on(TERMINAL_CHANNELS.exit, listener)
    return () => ipcRenderer.removeListener(TERMINAL_CHANNELS.exit, listener)
  },
  subscribeTerminalCommand: (callback) => {
    const listener = (_event: unknown, command: TerminalCommand): void => callback(command)
    ipcRenderer.on(TERMINAL_CHANNELS.command, listener)
    return () => ipcRenderer.removeListener(TERMINAL_CHANNELS.command, listener)
  },
  subscribeShowSettings: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on(SETTINGS_CHANNELS.showPage, listener)
    return () => ipcRenderer.removeListener(SETTINGS_CHANNELS.showPage, listener)
  }
}

contextBridge.exposeInMainWorld('desktop', desktopApi)
