export const SHELL_VIEW_IDS = ['agents', 'files', 'search', 'git'] as const

export type ShellViewId = (typeof SHELL_VIEW_IDS)[number]

export type SidePanelLayout = { width: number; collapsed: boolean }

/** The parts of the shell layout that are kept across restarts. */
export type ShellLayout = {
  activeView: ShellViewId
  panels: Record<ShellViewId, SidePanelLayout>
  /** The notifications panel on the right; it shares the side panels' width range. */
  notificationsWidth: number
  /** The workspace chat panel on the right, opened with New Chat (Ctrl/Cmd+Shift+L). */
  chatWidth: number
  /** The Git view's commit message box, resized from the handle on its top edge. */
  commitMessageHeight: number
}

/** Stored side panel widths; a narrow window still caps the panel on screen. */
export const SIDE_PANEL_WIDTH_RANGE = { min: 180, max: 4000 } as const

/** Stored commit message heights; a small window still caps the box on screen. */
export const COMMIT_MESSAGE_HEIGHT_RANGE = { min: 48, max: 4000 } as const

export const DEFAULT_PANEL: SidePanelLayout = { width: 300, collapsed: false }

export const DEFAULT_SHELL_LAYOUT: ShellLayout = {
  activeView: 'agents',
  panels: {
    agents: DEFAULT_PANEL,
    files: DEFAULT_PANEL,
    search: DEFAULT_PANEL,
    git: DEFAULT_PANEL
  },
  notificationsWidth: 380,
  chatWidth: 440,
  commitMessageHeight: 80
}

export const SHELL_LAYOUT_CHANNELS = {
  get: 'shell-layout:get',
  save: 'shell-layout:save'
} as const

export type ShellLayoutApi = {
  /** The layout saved when the app last ran, or the default one. */
  getShellLayout: () => Promise<ShellLayout>
  saveShellLayout: (layout: ShellLayout) => Promise<void>
}
