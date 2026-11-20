import { isPlainObject } from '../../shared/plain-object'
import {
  SHELL_VIEW_IDS,
  type ShellLayout,
  type ShellViewId,
  type SidePanelLayout,
  SIDE_PANEL_WIDTH_RANGE
} from '../../shared/shell-layout-api'

export type Bounds = { x: number; y: number; width: number; height: number }

/** The window as it was left: its normal (unmaximized) bounds and whether it was maximized. */
export type WindowPlacement = { bounds: Bounds; maximized: boolean }

const DEFAULT_WINDOW_SIZE = { width: 1200, height: 800 } as const
export const MIN_WINDOW_SIZE = { width: 600, height: 400 } as const
/** How much of the window must be on a display for it to count as reachable (enough to grab the title bar). */
const MIN_VISIBLE = { width: 100, height: 40 } as const

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

function isShellViewId(value: unknown): value is ShellViewId {
  return SHELL_VIEW_IDS.some((id) => id === value)
}

function sidePanel(value: unknown): SidePanelLayout | null {
  if (!isPlainObject(value) || typeof value.collapsed !== 'boolean') return null
  const { width } = value
  if (!isFiniteNumber(width)) return null
  if (width < SIDE_PANEL_WIDTH_RANGE.min || width > SIDE_PANEL_WIDTH_RANGE.max) return null
  return { width: Math.round(width), collapsed: value.collapsed }
}

/** A layout from the renderer or the state file, or null when any part of it is wrong. */
export function parseShellLayout(value: unknown): ShellLayout | null {
  if (!isPlainObject(value) || !isShellViewId(value.activeView)) return null
  const { panels } = value
  if (!isPlainObject(panels)) return null
  const [agents, files, git] = SHELL_VIEW_IDS.map((id) => sidePanel(panels[id]))
  if (!agents || !files || !git) return null
  return { activeView: value.activeView, panels: { agents, files, git } }
}

/** Saved window placement from the state file, or null when it is missing or wrong. */
export function parseWindowPlacement(value: unknown): WindowPlacement | null {
  if (!isPlainObject(value) || typeof value.maximized !== 'boolean') return null
  const { x, y, width, height } = value
  if (![x, y, width, height].every(isFiniteNumber)) return null
  return {
    bounds: {
      x: Math.round(Number(x)),
      y: Math.round(Number(y)),
      width: Math.max(MIN_WINDOW_SIZE.width, Math.round(Number(width))),
      height: Math.max(MIN_WINDOW_SIZE.height, Math.round(Number(height)))
    },
    maximized: value.maximized
  }
}

function overlap(a: Bounds, b: Bounds): { width: number; height: number } {
  return {
    width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  }
}

/** The default size, no bigger than the work area, centred on it. */
function centredBounds(workArea: Bounds): Bounds {
  const width = Math.min(DEFAULT_WINDOW_SIZE.width, workArea.width)
  const height = Math.min(DEFAULT_WINDOW_SIZE.height, workArea.height)
  return {
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
    width,
    height
  }
}

/**
 * Where to open the window: the saved bounds while enough of them is on some display (displays
 * change between runs), otherwise the default size centred on the primary display.
 */
export function placeWindow(saved: Bounds | null, workAreas: Bounds[], primary: Bounds): Bounds {
  if (!saved) return centredBounds(primary)
  const reachable = workAreas.some((area) => {
    const visible = overlap(saved, area)
    return visible.width >= MIN_VISIBLE.width && visible.height >= MIN_VISIBLE.height
  })
  return reachable ? saved : centredBounds(primary)
}
