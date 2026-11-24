import { describe, expect, it } from 'vitest'
import { DEFAULT_SHELL_LAYOUT } from '../../shared/shell-layout-api'
import { parseShellLayout, parseWindowPlacement, placeWindow } from './window-state-document'

const laptop = { x: 0, y: 0, width: 1920, height: 1050 }
const monitorLeft = { x: -2560, y: -200, width: 2560, height: 1400 }

describe('placeWindow', () => {
  it('keeps saved bounds that are on a display, including one left of the primary', () => {
    const onLaptop = { x: 100, y: 80, width: 900, height: 640 }
    const onMonitor = { x: -2000, y: 0, width: 1200, height: 800 }
    expect(placeWindow(onLaptop, [laptop, monitorLeft], laptop)).toEqual(onLaptop)
    expect(placeWindow(onMonitor, [laptop, monitorLeft], laptop)).toEqual(onMonitor)
  })

  it('fits a window that no longer fits onto the display showing most of it', () => {
    // Saved on a big monitor, reopened on a smaller one: shrunk to the work area.
    expect(placeWindow({ x: 0, y: 0, width: 2400, height: 1300 }, [laptop], laptop)).toEqual(laptop)
    // Hanging off the right and bottom edges: moved fully on, size kept.
    expect(placeWindow({ x: 1500, y: 700, width: 900, height: 600 }, [laptop], laptop)).toEqual({
      x: 1020,
      y: 450,
      width: 900,
      height: 600
    })
    // Title bar above the top edge: moved down so it can be grabbed.
    expect(placeWindow({ x: 100, y: -300, width: 900, height: 600 }, [laptop], laptop)).toEqual({
      x: 100,
      y: 0,
      width: 900,
      height: 600
    })
    // Straddling two displays: goes to the one with more of it.
    expect(
      placeWindow({ x: -300, y: 100, width: 1000, height: 600 }, [laptop, monitorLeft], laptop)
    ).toEqual({ x: 0, y: 100, width: 1000, height: 600 })
  })

  it('centres the default size on the primary display when the saved window is off every display', () => {
    const centred = { x: 360, y: 125, width: 1200, height: 800 }
    // The monitor it was on is unplugged.
    expect(placeWindow({ x: -2000, y: 0, width: 1200, height: 800 }, [laptop], laptop)).toEqual(
      centred
    )
    // Only a sliver (60 px) still pokes onto the display: too little to grab.
    expect(placeWindow({ x: 1860, y: 100, width: 900, height: 600 }, [laptop], laptop)).toEqual(
      centred
    )
    expect(placeWindow(null, [laptop], laptop)).toEqual(centred)
    // A small display gets a window that fits it.
    const small = { x: 0, y: 30, width: 1024, height: 700 }
    expect(placeWindow(null, [small], small)).toEqual({ x: 0, y: 30, width: 1024, height: 700 })
  })
})

describe('parseWindowPlacement', () => {
  it('reads bounds and maximized state, raising sizes below the window minimum', () => {
    expect(
      parseWindowPlacement({ x: 10.4, y: -20, width: 300, height: 900, maximized: true })
    ).toEqual({ bounds: { x: 10, y: -20, width: 600, height: 900 }, maximized: true })
    expect(
      parseWindowPlacement({ x: 10, y: 20, width: 'wide', height: 900, maximized: false })
    ).toBe(null)
    expect(parseWindowPlacement({ x: 10, y: 20, width: 800, height: 900 })).toBe(null)
  })
})

describe('parseShellLayout', () => {
  it('accepts a complete layout and rejects unknown views, widths out of range and non-booleans', () => {
    const layout = {
      activeView: 'files',
      panels: {
        agents: { width: 250.6, collapsed: true },
        files: { width: 420, collapsed: false },
        search: { width: 360, collapsed: true },
        git: { width: 180, collapsed: false }
      },
      notificationsWidth: 400.4
    }
    expect(parseShellLayout(layout)).toEqual({
      ...layout,
      panels: { ...layout.panels, agents: { width: 251, collapsed: true } },
      notificationsWidth: 400
    })
    expect(parseShellLayout({ ...layout, activeView: 'terminal' })).toBe(null)
    const withPanel = (panel: unknown) => ({ ...layout, panels: { ...layout.panels, git: panel } })
    expect(parseShellLayout(withPanel({ width: 120, collapsed: false }))).toBe(null)
    expect(parseShellLayout(withPanel({ width: 5000, collapsed: false }))).toBe(null)
    expect(parseShellLayout(withPanel({ width: 300, collapsed: 'yes' }))).toBe(null)
    expect(parseShellLayout(withPanel(undefined))).toBe(null)
    expect(parseShellLayout(DEFAULT_SHELL_LAYOUT)).toEqual(DEFAULT_SHELL_LAYOUT)
    const withSearch = (panel: unknown) => ({
      ...layout,
      panels: { ...layout.panels, search: panel }
    })
    expect(parseShellLayout(withSearch({ width: 300, collapsed: 'yes' }))).toBe(null)
  })

  it('gives a layout saved before Find in Files existed a new search panel, keeping the rest', () => {
    const { search: _unused, ...older } = DEFAULT_SHELL_LAYOUT.panels
    const files = { width: 420, collapsed: true }
    expect(parseShellLayout({ ...DEFAULT_SHELL_LAYOUT, panels: { ...older, files } })).toEqual({
      ...DEFAULT_SHELL_LAYOUT,
      panels: { ...DEFAULT_SHELL_LAYOUT.panels, files }
    })
  })

  it('keeps the side panels of a layout without a valid notifications width, using the default', () => {
    const { notificationsWidth: _unused, ...older } = DEFAULT_SHELL_LAYOUT
    const files = { width: 420, collapsed: true }
    const saved = { ...older, panels: { ...older.panels, files } }
    const expected = { ...DEFAULT_SHELL_LAYOUT, panels: { ...DEFAULT_SHELL_LAYOUT.panels, files } }
    expect(parseShellLayout(saved)).toEqual(expected)
    expect(parseShellLayout({ ...saved, notificationsWidth: 50 })).toEqual(expected)
  })
})
