import { app, BrowserWindow } from 'electron'
import { registerAppInfoIpc } from './ipc/app-info-ipc'
import { registerWorkspaceIpc } from './ipc/workspace-ipc'
import { installAppMenu } from './menu/app-menu'
import { createMainWindow } from './window/main-window'

app.enableSandbox()

void app.whenReady().then(() => {
  registerAppInfoIpc()
  registerWorkspaceIpc()
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
