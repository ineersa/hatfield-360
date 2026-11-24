import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import appIcon from '../../../resources/icon.png?asset'
import { rendererEntryUrl } from './renderer-entry'
import { MIN_WINDOW_SIZE } from './window-state-document'
import { guardUnsavedChanges } from './unsaved-changes-guard'
import { windowStateStore } from './window-state-store'
import { isBackgroundLaunch } from './window-launch-mode'
import { appThemeFrame } from './window-theme'
import type { AppThemeId } from '../../shared/settings-api'

/** Opens the app window in the given app theme, so it doesn't flash another theme's colours. */
export function createMainWindow(theme: AppThemeId): BrowserWindow {
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
    // Shown until the renderer paints, so a light theme doesn't flash dark or a dark one white.
    backgroundColor: appThemeFrame(theme),
    // Linux takes the window/taskbar icon from here; macOS and Windows use the packaged app icon.
    ...(process.platform === 'linux' ? { icon: appIcon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: !background,
      // A never-shown window otherwise draws about once a second, and each mouse event waits for a frame.
      offscreen: background
    }
  })

  if (!background) {
    window.once('ready-to-show', () => {
      // maximize() also shows the window, so a background launch never calls it.
      if (maximized) window.maximize()
      window.show()
    })
  }
  windowStateStore.track(window, { background, requested: bounds })
  guardUnsavedChanges(window)

  // The window only ever shows the app. Opening external links needs an explicit, validated IPC capability.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())

  // The page applies the theme before its first render, from this query.
  const url = new URL(rendererEntryUrl())
  url.searchParams.set('theme', theme)
  void window.loadURL(url.href)
  return window
}
