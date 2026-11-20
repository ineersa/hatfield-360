import { contextBridge, ipcRenderer } from 'electron'
import { type DesktopApi, IPC_CHANNELS } from '../shared/desktop-api'
import { SETTINGS_CHANNELS, type SettingsView } from '../shared/settings-api'
import { SHELL_LAYOUT_CHANNELS } from '../shared/shell-layout-api'
import { TERMINAL_CHANNELS, type TerminalCommand, type TerminalExit } from '../shared/terminal-api'
import { type WorkspaceView, WORKSPACE_CHANNELS } from '../shared/workspace-api'
import { type ProjectWorktrees, WORKTREE_CHANNELS } from '../shared/worktree-api'

const desktopApi: DesktopApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getAppInfo),
  getWorkspace: () => ipcRenderer.invoke(WORKSPACE_CHANNELS.get),
  addWorkspaceFolder: () => ipcRenderer.invoke(WORKSPACE_CHANNELS.addFolder),
  removeWorkspaceFolder: (path) => ipcRenderer.invoke(WORKSPACE_CHANNELS.removeFolder, path),
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
  openTerminalLink: (url) => ipcRenderer.invoke(TERMINAL_CHANNELS.openLink, url),
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
