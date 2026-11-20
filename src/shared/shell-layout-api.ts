export const SHELL_VIEW_IDS = ['agents', 'files', 'git'] as const

export type ShellViewId = (typeof SHELL_VIEW_IDS)[number]

export type SidePanelLayout = { width: number; collapsed: boolean }

/** The parts of the shell layout that are kept across restarts. */
export type ShellLayout = {
  activeView: ShellViewId
  panels: Record<ShellViewId, SidePanelLayout>
}

/** Stored side panel widths; a narrow window still caps the panel on screen. */
export const SIDE_PANEL_WIDTH_RANGE = { min: 180, max: 4000 } as const

const DEFAULT_PANEL: SidePanelLayout = { width: 300, collapsed: false }

export const DEFAULT_SHELL_LAYOUT: ShellLayout = {
  activeView: 'agents',
  panels: { agents: DEFAULT_PANEL, files: DEFAULT_PANEL, git: DEFAULT_PANEL }
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
