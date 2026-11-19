import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import { sep } from 'node:path'
import type { RecentEntry, WorkspaceView } from '../../shared/workspace-api'
import {
  openRecentOrOfferRemoval,
  pickAndAddWorkspaceFolder,
  pickAndOpenWorkspaceFile,
  pickAndSaveWorkspaceAs
} from '../workspace/workspace-dialogs'
import { WORKSPACE_FILE_EXTENSION } from '../workspace/workspace-file'
import { workspaceStore } from '../workspace/workspace-store'

/** Runs a menu action against the focused window; failures are shown in the window. */
function fromMenu(action: (window: BrowserWindow | null) => Promise<void>): () => void {
  return () => {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
    action(window).catch((error: unknown) => workspaceStore.report(error))
  }
}

/** `~/projects/api` on macOS and Linux, like VS Code's Open Recent. */
function displayPath(path: string): string {
  const home = app.getPath('home')
  return process.platform !== 'win32' && path.startsWith(`${home}${sep}`)
    ? `~${path.slice(home.length)}`
    : path
}

function recentLabel(entry: RecentEntry): string {
  const label =
    entry.kind === 'default'
      ? entry.name
      : entry.kind === 'workspace'
        ? `${displayPath(entry.path.slice(0, -WORKSPACE_FILE_EXTENSION.length))} (Workspace)`
        : displayPath(entry.path)
  // `&` marks a mnemonic in menu labels on Linux and Windows.
  return `${label}${entry.missing ? ' (missing)' : ''}`.replaceAll('&', '&&')
}

function openRecentMenu(view: WorkspaceView | null): MenuItemConstructorOptions[] {
  const recent = view?.recent ?? []
  const item = (entry: RecentEntry): MenuItemConstructorOptions => ({
    label: recentLabel(entry),
    enabled: !entry.current,
    click: fromMenu((window) => openRecentOrOfferRemoval(window, entry))
  })
  const group = (kind: RecentEntry['kind']): MenuItemConstructorOptions[] => {
    const items = recent.filter((entry) => entry.kind === kind).map(item)
    return items.length > 0 ? [{ type: 'separator' }, ...items] : []
  }
  return [
    ...recent.filter((entry) => entry.kind === 'default').map(item),
    ...group('workspace'),
    ...group('folder'),
    { type: 'separator' },
    {
      id: 'clear-recent',
      label: 'Clear Recently Opened',
      enabled: recent.length > 1,
      click: fromMenu(() => workspaceStore.clearRecent())
    }
  ]
}

function buildAppMenu(view: WorkspaceView | null): void {
  const isMac = process.platform === 'darwin'
  const inWorkspaceFile = typeof view?.file === 'string'
  const fileMenu: MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      {
        id: 'open-folder',
        label: 'Open Folder…',
        accelerator: 'CommandOrControl+O',
        click: fromMenu(pickAndAddWorkspaceFolder)
      },
      {
        id: 'open-workspace-file',
        label: 'Open Workspace from File…',
        click: fromMenu(pickAndOpenWorkspaceFile)
      },
      { id: 'open-recent', label: 'Open Recent', submenu: openRecentMenu(view) },
      { type: 'separator' },
      {
        id: 'add-folder-to-workspace',
        label: 'Add Folder to Workspace…',
        click: fromMenu(pickAndAddWorkspaceFolder)
      },
      {
        id: 'save-workspace-as',
        label: 'Save Workspace As…',
        click: fromMenu((window) => pickAndSaveWorkspaceAs(window, 'save-as'))
      },
      {
        id: 'duplicate-workspace',
        label: 'Duplicate Workspace…',
        enabled: inWorkspaceFile,
        click: fromMenu((window) => pickAndSaveWorkspaceAs(window, 'duplicate'))
      },
      { type: 'separator' },
      {
        id: 'close-workspace',
        label: 'Close Workspace',
        enabled: inWorkspaceFile,
        click: fromMenu(() => workspaceStore.closeWorkspace())
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

/** The native application menu (menu bar on Linux and Windows, top bar on macOS), rebuilt as the workspace changes. */
export function installAppMenu(): void {
  buildAppMenu(null)
  workspaceStore.onChange(buildAppMenu)
  workspaceStore
    .view()
    .then(buildAppMenu)
    .catch((error: unknown) => console.error('Loading the workspace for the menu failed:', error))
}
