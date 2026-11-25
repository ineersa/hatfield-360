import { create } from 'zustand'
import {
  DEFAULT_SHELL_LAYOUT,
  type ShellLayout,
  type ShellViewId,
  SIDE_PANEL_WIDTH_RANGE,
  type SidePanelLayout
} from '../../../shared/shell-layout-api'

export const SIDE_PANEL_MIN_WIDTH = SIDE_PANEL_WIDTH_RANGE.min

type ShellLayoutState = {
  activeView: ShellViewId
  panels: Record<ShellViewId, SidePanelLayout>
  notificationsWidth: number
  chatWidth: number
  /** The saved layout has been applied; the shell waits for it so it doesn't jump after the first paint. */
  loaded: boolean
  /** The Settings page covers the main area until it is closed or a view is chosen. */
  settingsOpen: boolean
  /** Restores the layout saved last time and saves every later change; returns the unsubscribe. */
  connect: () => () => void
  openSettings: () => void
  closeSettings: () => void
  showAgents: () => void
  /** Shows the Files view, where editor tabs are, leaving Settings. */
  showFiles: () => void
  /** Activating the current view toggles its side panel, like JetBrains tool window buttons. */
  activateView: (view: ShellViewId) => void
  /** Shows the view with its side panel open, whatever was shown before. */
  showPanel: (view: ShellViewId) => void
  hidePanel: (view: ShellViewId) => void
  setPanelWidth: (view: ShellViewId, width: number) => void
  setNotificationsWidth: (width: number) => void
  setChatWidth: (width: number) => void
}

const clampWidth = (width: number): number =>
  Math.round(Math.min(SIDE_PANEL_WIDTH_RANGE.max, Math.max(SIDE_PANEL_WIDTH_RANGE.min, width)))

const savedPart = ({
  activeView,
  panels,
  notificationsWidth,
  chatWidth
}: ShellLayout): ShellLayout => ({
  activeView,
  panels,
  notificationsWidth,
  chatWidth
})

export const useShellLayoutStore = create<ShellLayoutState>((set, get) => ({
  ...DEFAULT_SHELL_LAYOUT,
  loaded: false,
  settingsOpen: false,
  connect: () => {
    let connected = true
    let unsubscribe: (() => void) | null = null
    const follow = (): void => {
      // Main batches the writes, so every change can go straight there and survives a quick quit.
      unsubscribe = useShellLayoutStore.subscribe((state, previous) => {
        if (
          state.activeView === previous.activeView &&
          state.panels === previous.panels &&
          state.notificationsWidth === previous.notificationsWidth &&
          state.chatWidth === previous.chatWidth
        )
          return
        window.desktop.saveShellLayout(savedPart(state)).catch((error: unknown) => {
          console.error('Saving the layout failed:', error)
        })
      })
    }
    window.desktop
      .getShellLayout()
      .then((layout) => {
        if (connected) set({ ...savedPart(layout), loaded: true })
      })
      .catch((error: unknown) => {
        console.error('Loading the saved layout failed:', error)
        if (connected) set({ loaded: true })
      })
      .finally(() => {
        if (connected && get().loaded) follow()
      })
    return () => {
      connected = false
      unsubscribe?.()
    }
  },
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  showAgents: () => set({ activeView: 'agents', settingsOpen: false }),
  showFiles: () => set({ activeView: 'files', settingsOpen: false }),
  activateView: (view) => {
    set((state) => {
      // Leaving Settings shows the chosen view as it was, without toggling its panel.
      if (state.settingsOpen) return { settingsOpen: false, activeView: view }
      if (state.activeView !== view) {
        return { activeView: view }
      }
      const panel = state.panels[view]
      return { panels: { ...state.panels, [view]: { ...panel, collapsed: !panel.collapsed } } }
    })
  },
  showPanel: (view) =>
    set((state) => ({
      settingsOpen: false,
      activeView: view,
      panels: { ...state.panels, [view]: { ...state.panels[view], collapsed: false } }
    })),
  hidePanel: (view) =>
    set((state) => ({
      panels: { ...state.panels, [view]: { ...state.panels[view], collapsed: true } }
    })),
  setPanelWidth: (view, width) => {
    set((state) => ({
      panels: { ...state.panels, [view]: { ...state.panels[view], width: clampWidth(width) } }
    }))
  },
  setNotificationsWidth: (width) => set({ notificationsWidth: clampWidth(width) }),
  setChatWidth: (width) => set({ chatWidth: clampWidth(width) })
}))
