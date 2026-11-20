import { app, BrowserWindow } from 'electron'
import { registerAppInfoIpc } from './ipc/app-info-ipc'
import { registerSettingsIpc } from './ipc/settings-ipc'
import { registerWorkspaceIpc } from './ipc/workspace-ipc'
import { installAppMenu } from './menu/app-menu'
import { createMainWindow } from './window/main-window'
import { installPermissionPolicy } from './window/permission-policy'

app.enableSandbox()

void app.whenReady().then(() => {
  installPermissionPolicy()
  registerAppInfoIpc()
  registerWorkspaceIpc()
  registerSettingsIpc()
  installAppMenu()
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
