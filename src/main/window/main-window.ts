import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import appIcon from '../../../resources/icon.png?asset'
import { rendererEntryUrl } from './renderer-entry'
import { MIN_WINDOW_SIZE } from './window-state-document'
import { windowStateStore } from './window-state-store'
import { isBackgroundLaunch } from './window-launch-mode'

export function createMainWindow(): BrowserWindow {
  const background = isBackgroundLaunch(process.env)
  const { bounds, maximized } = windowStateStore.initialPlacement()
  const window = new BrowserWindow({
    ...bounds,
    // Narrowest window that still fits the activity bar, a minimum side panel and a usable main area.
    minWidth: MIN_WINDOW_SIZE.width,
    minHeight: MIN_WINDOW_SIZE.height,
    show: false,
    // Menu bar hidden until Alt on Linux/Windows (user preference); macOS uses the top bar.
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
    window.once('ready-to-show', () => {
      // maximize() also shows the window, so a background launch never calls it.
      if (maximized) window.maximize()
      window.show()
    })
  }
  windowStateStore.track(window, { background })

  // The window only ever shows the app. Opening external links needs an explicit, validated IPC capability.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())

  void window.loadURL(rendererEntryUrl())
  return window
}
