import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import { pickAndAddWorkspaceFolder } from '../workspace/workspace-folder-picker'

function addFolderFromMenu(): void {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
  pickAndAddWorkspaceFolder(window).catch((error: unknown) => {
    console.error('Adding a workspace folder failed:', error)
  })
}

/** The native application menu: menu bar on Linux and Windows, top bar on macOS. */
export function installAppMenu(): void {
  const isMac = process.platform === 'darwin'
  const fileMenu: MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      {
        id: 'open-folder',
        label: 'Open Folder…',
        accelerator: 'CommandOrControl+O',
        click: addFolderFromMenu
      },
      {
        id: 'add-folder-to-workspace',
        label: 'Add Folder to Workspace…',
        click: addFolderFromMenu
      },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit', label: 'Exit' }
    ]
  }
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ label: app.name, role: 'appMenu' } as const] : []),
    fileMenu,
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
