import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import { sep } from 'node:path'
import type { KeybindingsView } from '../../shared/keybindings-api'
import type { TerminalCommand } from '../../shared/terminal-api'
import {
  appShortcut,
  shellKeymap,
  terminalShortcut,
  type AppCommand,
  type ShellKeymap
} from '../../shared/keymap'
import type { RecentEntry, WorkspaceView } from '../../shared/workspace-api'
import {
  openRecentOrOfferRemoval,
  pickAndAddWorkspaceFolder,
  pickAndOpenWorkspaceFile,
  pickAndSaveWorkspaceAs
} from '../workspace/workspace-dialogs'
import { sendSaveCommand } from '../ipc/editor-ipc'
import { showKeybindingsFile } from '../ipc/keybindings-ipc'
import { showSettingsPage } from '../ipc/settings-ipc'
import { keybindingsStore } from '../keybindings/keybindings-store'
import { sendTerminalCommand } from '../ipc/terminal-ipc'
import { openSettingsFile } from '../settings/open-settings-file'
import { settingsStore } from '../settings/settings-store'
import { WORKSPACE_FILE_EXTENSION } from '../workspace/workspace-file'
import { workspaceStore } from '../workspace/workspace-store'

/** Runs a menu action against the focused window; failures are shown in the window. */
function fromMenu(
  action: (window: BrowserWindow | null) => Promise<void>,
  report: (error: unknown) => Promise<void> = (error) => workspaceStore.report(error)
): () => void {
  return () => {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
    action(window).catch(report)
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
      : entry.stored
        ? `${entry.name} (Workspace)`
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

function shownKey(key: string | null): { accelerator?: string } {
  return key === null ? {} : { accelerator: key }
}

function buildAppMenu(view: WorkspaceView | null, keymap: ShellKeymap): void {
  /** A menu item's key from the keys in force, shown on the item. */
  const accelerator = (command: AppCommand): { accelerator?: string } =>
    shownKey(appShortcut(keymap, command))
  const isMac = process.platform === 'darwin'
  const inWorkspaceFile = typeof view?.file === 'string'
  const fileMenu: MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      {
        id: 'open-folder',
        label: 'Open Folder…',
        ...accelerator('open-folder'),
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
        id: 'save-file',
        label: 'Save',
        ...accelerator('save'),
        click: fromMenu(sendSaveCommand)
      },
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
      {
        id: 'preferences',
        label: 'Preferences',
        submenu: [
          {
            id: 'open-settings',
            label: 'Settings',
            ...accelerator('settings'),
            click: fromMenu(showSettingsPage, (error) => settingsStore.report(error))
          },
          {
            id: 'open-settings-json',
            label: 'Open Settings (JSON)',
            click: fromMenu(openSettingsFile, (error) => settingsStore.report(error))
          },
          {
            id: 'open-keybindings-json',
            label: 'Open Keybindings (JSON)',
            click: fromMenu(showKeybindingsFile, (error) => keybindingsStore.report(error))
          }
        ]
      },
      { type: 'separator' },
      isMac ? { role: 'close', ...accelerator('close-window') } : { role: 'quit', label: 'Exit' }
    ]
  }
  const terminalItem = (command: TerminalCommand, label: string): MenuItemConstructorOptions => ({
    id: `terminal-${command}`,
    label,
    ...shownKey(terminalShortcut(keymap, command)),
    // Shown, not registered: the page runs these keys by what has focus (the editor keeps Ctrl+Shift+W).
    // macOS registers menu keys regardless; the page stops the ones it handles first.
    registerAccelerator: false,
    click: fromMenu((window) => sendTerminalCommand(window, command))
  })
  const terminalMenu: MenuItemConstructorOptions = {
    label: 'Terminal',
    submenu: [
      terminalItem('new-terminal', 'New Terminal'),
      { type: 'separator' },
      terminalItem('split-right', 'Split Right'),
      terminalItem('split-down', 'Split Down'),
      terminalItem('close-pane', 'Close Pane'),
      { type: 'separator' },
      terminalItem('focus-next-pane', 'Focus Next Pane'),
      terminalItem('focus-previous-pane', 'Focus Previous Pane'),
      terminalItem('next-tab', 'Next Terminal Tab'),
      terminalItem('previous-tab', 'Previous Terminal Tab')
    ]
  }
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ label: app.name, role: 'appMenu' } as const] : []),
    fileMenu,
    { role: 'editMenu' },
    { role: 'viewMenu' },
    terminalMenu,
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** The native application menu (menu bar on Linux and Windows, top bar on macOS), rebuilt as the workspace or the keys change. */
export function installAppMenu(): void {
  let view: WorkspaceView | null = null
  let keymap = shellKeymap(process.platform)
  const build = (): void => buildAppMenu(view, keymap)
  const showWorkspace = (next: WorkspaceView): void => {
    view = next
    build()
  }
  const showKeys = ({ entries }: KeybindingsView): void => {
    keymap = shellKeymap(process.platform, entries)
    build()
  }
  build()
  workspaceStore.onChange(showWorkspace)
  keybindingsStore.onChange(showKeys)
  workspaceStore
    .view()
    .then(showWorkspace)
    .catch((error: unknown) => console.error('Loading the workspace for the menu failed:', error))
  keybindingsStore
    .view()
    .then(showKeys)
    .catch((error: unknown) => console.error('Loading keybindings for the menu failed:', error))
}
