import { workspaceStore } from './workspace/workspace-store'
import { registerLanguageServerIpc } from './ipc/language-server-ipc'
import { languageServerSessions } from './language-servers/language-server-sessions'
import { registerAgentIpc } from './ipc/agent-ipc'
import { app, BrowserWindow } from 'electron'
import { agentStatusServer } from './agent-status/status-server'
import { separateDevAppData } from './app-data-folder'
import { registerAppInfoIpc } from './ipc/app-info-ipc'
import { filesSessionStore } from './files/files-session-store'
import { registerEditorIpc } from './ipc/editor-ipc'
import { registerFilesSessionIpc } from './ipc/files-session-ipc'
import { registerFileTreeIpc } from './ipc/file-tree-ipc'
import { registerKeybindingsIpc } from './ipc/keybindings-ipc'
import { registerSettingsIpc } from './ipc/settings-ipc'
import { registerShellLayoutIpc } from './ipc/shell-layout-ipc'
import { registerTerminalIpc } from './ipc/terminal-ipc'
import { registerWebLinkIpc } from './ipc/web-link-ipc'
import { registerWorkspaceIpc } from './ipc/workspace-ipc'
import { registerWorktreeIpc } from './ipc/worktree-ipc'
import { installAppMenu } from './menu/app-menu'
import { terminalSessions } from './terminal/terminal-sessions'
import { createMainWindow } from './window/main-window'
import { installPermissionPolicy } from './window/permission-policy'
import { quitWaitsForUnsavedChanges } from './window/unsaved-changes-guard'
import { windowStateStore } from './window/window-state-store'
import { chosenAppTheme, followAppTheme } from './window/window-theme'

// Before anything reads userData, and before ready so Chromium's profile follows.
separateDevAppData()
app.enableSandbox()

void app.whenReady().then(async () => {
  if (quitting) return
  void agentStatusServer.start().catch((error: unknown) => {
    console.error('Starting agent status server failed:', error)
  })
  installPermissionPolicy()
  registerAppInfoIpc()
  registerWorkspaceIpc()
  registerWorktreeIpc()
  registerFileTreeIpc()
  registerEditorIpc()
  registerFilesSessionIpc()
  registerSettingsIpc()
  registerKeybindingsIpc()
  registerShellLayoutIpc()
  registerTerminalIpc()
  registerWebLinkIpc()
  registerAgentIpc()
  registerLanguageServerIpc()
  installAppMenu()
  followAppTheme()
  // The window opens where it was left and in the chosen theme, so both are read first.
  const [, theme] = await Promise.all([windowStateStore.load(), chosenAppTheme()])
  createMainWindow(theme)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void chosenAppTheme().then(createMainWindow)
    }
  })
})

// Quitting waits for the window state to be written and for every terminal's shell to end,
// so the last size and layout survive and no shell outlives the app.
let readyToQuit = false
let quitting = false
app.on('before-quit', (event) => {
  if (readyToQuit) return
  event.preventDefault()
  if (quitting) return
  // Unsaved edits are saved or discarded first; a cancelled quit leaves everything running.
  if (quitWaitsForUnsavedChanges()) return
  quitting = true
  void Promise.allSettled([
    agentStatusServer.stop().catch((error: unknown) => {
      console.error('Stopping agent status server failed:', error)
    }),
    windowStateStore
      .flush()
      .catch((error: unknown) => console.error('Saving window state failed:', error)),
    filesSessionStore
      .flush()
      .catch((error: unknown) => console.error('Saving Files sessions failed:', error)),
    workspaceStore.flush(),
    terminalSessions.killAll(),
    languageServerSessions.stopAll()
  ]).finally(() => {
    readyToQuit = true
    app.quit()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
