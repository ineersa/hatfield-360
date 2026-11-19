import { create } from 'zustand'
import type { ShellViewId } from '@/components/shell/shell-views'

export const SIDE_PANEL_MIN_WIDTH = 180
const SIDE_PANEL_DEFAULT_WIDTH = 300

type SidePanelState = { width: number; collapsed: boolean }

type ShellLayoutState = {
  activeView: ShellViewId
  panels: Record<ShellViewId, SidePanelState>
  /** Activating the current view toggles its side panel, like JetBrains tool window buttons. */
  activateView: (view: ShellViewId) => void
  setPanelWidth: (view: ShellViewId, width: number) => void
}

const defaultPanel: SidePanelState = { width: SIDE_PANEL_DEFAULT_WIDTH, collapsed: false }

export const useShellLayoutStore = create<ShellLayoutState>((set) => ({
  activeView: 'agents',
  panels: { agents: defaultPanel, files: defaultPanel, git: defaultPanel },
  activateView: (view) => {
    set((state) => {
      if (state.activeView !== view) {
        return { activeView: view }
      }
      const panel = state.panels[view]
      return { panels: { ...state.panels, [view]: { ...panel, collapsed: !panel.collapsed } } }
    })
  },
  setPanelWidth: (view, width) => {
    const clamped = Math.round(Math.max(SIDE_PANEL_MIN_WIDTH, width))
    set((state) => ({
      panels: { ...state.panels, [view]: { ...state.panels[view], width: clamped } }
    }))
  }
}))
