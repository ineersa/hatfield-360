import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import appIcon from '../../../resources/icon.png?asset'
import { rendererEntryUrl } from './renderer-entry'
import { isBackgroundLaunch } from './window-launch-mode'

export function createMainWindow(): BrowserWindow {
  const background = isBackgroundLaunch(process.env)
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    // Islands Dark frame colour, so the window doesn't flash white before the renderer paints.
    backgroundColor: '#26282c',
    // Linux takes the window/taskbar icon from here; macOS and Windows use the packaged app icon.
    ...(process.platform === 'linux' ? { icon: appIcon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: !background
    }
  })

  if (!background) {
    window.once('ready-to-show', () => window.show())
  }

  // The window only ever shows the app. Opening external links needs an explicit, validated IPC capability.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())

  void window.loadURL(rendererEntryUrl())
  return window
}
