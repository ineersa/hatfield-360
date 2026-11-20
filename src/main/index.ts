import { app, BrowserWindow } from 'electron'
import { registerAppInfoIpc } from './ipc/app-info-ipc'
import { registerSettingsIpc } from './ipc/settings-ipc'
import { registerShellLayoutIpc } from './ipc/shell-layout-ipc'
import { registerTerminalIpc } from './ipc/terminal-ipc'
import { registerWorkspaceIpc } from './ipc/workspace-ipc'
import { installAppMenu } from './menu/app-menu'
import { terminalSessions } from './terminal/terminal-sessions'
import { createMainWindow } from './window/main-window'
import { installPermissionPolicy } from './window/permission-policy'
import { windowStateStore } from './window/window-state-store'

app.enableSandbox()

void app.whenReady().then(async () => {
  installPermissionPolicy()
  registerAppInfoIpc()
  registerWorkspaceIpc()
  registerSettingsIpc()
  registerShellLayoutIpc()
  registerTerminalIpc()
  installAppMenu()
  // The window opens where it was left, so the saved placement is read first.
  await windowStateStore.load()
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

// Quitting waits for the window state to be written and for every terminal's shell to end,
// so the last size and layout survive and no shell outlives the app.
let readyToQuit = false
app.on('before-quit', (event) => {
  if (readyToQuit) return
  event.preventDefault()
  void Promise.allSettled([
    windowStateStore
      .flush()
      .catch((error: unknown) => console.error('Saving window state failed:', error)),
    terminalSessions.killAll()
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
