import { AGENT_CHANNELS, type AgentNotification, type AgentSnapshot } from '../shared/agent-api'
import { contextBridge, ipcRenderer } from 'electron'
import { type DesktopApi, IPC_CHANNELS } from '../shared/desktop-api'
import { EDITOR_CHANNELS } from '../shared/editor-api'
import { FILES_SESSION_CHANNELS } from '../shared/files-session-api'
import { FILE_TREE_CHANNELS } from '../shared/file-tree-api'
import { SETTINGS_CHANNELS, type SettingsView } from '../shared/settings-api'
import { SHELL_LAYOUT_CHANNELS } from '../shared/shell-layout-api'
import { LANGUAGE_SERVER_CHANNELS, type LanguageServerStatus } from '../shared/language-server-api'
import { TERMINAL_CHANNELS, type TerminalCommand, type TerminalExit } from '../shared/terminal-api'
import { type WorkspaceView, WORKSPACE_CHANNELS } from '../shared/workspace-api'
import { WEB_LINK_CHANNELS } from '../shared/web-link-api'
import { type ProjectWorktrees, WORKTREE_CHANNELS } from '../shared/worktree-api'

const desktopApi: DesktopApi = {
  launchAgent: (request) => ipcRenderer.invoke(AGENT_CHANNELS.launch, request),
  getAgentSessions: () => ipcRenderer.invoke(AGENT_CHANNELS.get),
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
  getWorktrees: () => ipcRenderer.invoke(WORKTREE_CHANNELS.get),
  subscribeWorktrees: (callback) => {
    const listener = (_event: unknown, projects: ProjectWorktrees[]): void => callback(projects)
    ipcRenderer.on(WORKTREE_CHANNELS.changed, listener)
    return () => ipcRenderer.removeListener(WORKTREE_CHANNELS.changed, listener)
  },
  listDirectory: (path) => ipcRenderer.invoke(FILE_TREE_CHANNELS.list, path),
  watchDirectories: (paths) => ipcRenderer.invoke(FILE_TREE_CHANNELS.watch, paths),
  copyPath: (path, form) => ipcRenderer.invoke(FILE_TREE_CHANNELS.copyPath, path, form),
  revealPath: (path) => ipcRenderer.invoke(FILE_TREE_CHANNELS.reveal, path),
  subscribeDirectoryChanges: (callback) => {
    const listener = (_event: unknown, paths: string[]): void => callback(paths)
    ipcRenderer.on(FILE_TREE_CHANNELS.changed, listener)
    return () => ipcRenderer.removeListener(FILE_TREE_CHANNELS.changed, listener)
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
