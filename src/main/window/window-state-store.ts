import { app, type BrowserWindow, screen } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isPlainObject } from '../../shared/plain-object'
import { DEFAULT_SHELL_LAYOUT, type ShellLayout } from '../../shared/shell-layout-api'
import { writeFileAtomic } from '../files/atomic-write'
import {
  parseShellLayout,
  parseWindowPlacement,
  placeWindow,
  type Bounds,
  type WindowPlacement
} from './window-state-document'

const sameBounds = (a: Bounds, b: Bounds): boolean =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height

const WINDOW_STATE_FILE_NAME = 'window-state.json'
const WINDOW_STATE_VERSION = 1
/** Resizing and dragging fire many events; the file is written once things settle (and on quit). */
const SAVE_DELAY_MS = 500

/**
 * `userData/window-state.json`: the window's placement and the shell layout, restored at the next
 * launch. App-owned like state.json, but separate so the workspace and window never write one file.
 */
class WindowStateStore {
  private placement: WindowPlacement | null = null
  private layout: ShellLayout = DEFAULT_SHELL_LAYOUT
  private loaded: Promise<void> | null = null
  private saveTimer: NodeJS.Timeout | null = null
  private dirty = false
  /** Serializes writes so an older one never lands after a newer one. */
  private writing: Promise<void> = Promise.resolve()

  constructor(private readonly dataDir: () => string) {}

  private file(): string {
    return join(this.dataDir(), WINDOW_STATE_FILE_NAME)
  }

  /** Reads the saved state once; a missing or damaged file just means defaults. */
  load(): Promise<void> {
    this.loaded ??= readFile(this.file(), 'utf8')
      .then((text) => {
        const data: unknown = JSON.parse(text)
        if (!isPlainObject(data)) return
        this.placement = parseWindowPlacement(data.window)
        this.layout = parseShellLayout(data.layout) ?? DEFAULT_SHELL_LAYOUT
      })
      .catch(() => undefined)
    return this.loaded
  }

  /** Where to open the window, kept on a connected display. */
  initialPlacement(): WindowPlacement {
    const workAreas = screen.getAllDisplays().map((display) => display.workArea)
    const bounds = placeWindow(
      this.placement?.bounds ?? null,
      workAreas,
      screen.getPrimaryDisplay().workArea
    )
    return { bounds, maximized: this.placement?.maximized ?? false }
  }

  async shellLayout(): Promise<ShellLayout> {
    await this.load()
    return this.layout
  }

  saveShellLayout(layout: ShellLayout): void {
    this.layout = layout
    this.scheduleSave()
  }

  /**
   * Follows the window's size, position and maximized state. A background launch never maximizes
   * its hidden window, so it keeps the saved maximized state instead of recording "not maximized".
   */
  track(window: BrowserWindow, options: { background: boolean; requested: Bounds }): void {
    const savedMaximized = this.placement?.maximized ?? false
    // Fractional display scaling rounds the window a pixel or so outward from what was asked for;
    // saving that would grow the window on every launch, so it's kept until the user moves or resizes it.
    const opened = window.getNormalBounds()
    const record = (): void => {
      if (window.isDestroyed()) return
      const bounds = window.getNormalBounds()
      this.placement = {
        bounds: sameBounds(bounds, opened) ? options.requested : bounds,
        maximized: options.background ? savedMaximized : window.isMaximized()
      }
      this.scheduleSave()
    }
    window.on('resize', record)
    window.on('move', record)
    window.on('maximize', record)
    window.on('unmaximize', record)
    window.on('close', record)
  }

  /** Writes pending changes now; called on quit. */
  flush(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    if (!this.dirty) return this.writing
    this.dirty = false
    const contents = {
      version: WINDOW_STATE_VERSION,
      ...(this.placement
        ? { window: { ...this.placement.bounds, maximized: this.placement.maximized } }
        : {}),
      layout: this.layout
    }
    this.writing = this.writing
      .catch(() => undefined)
      .then(() => writeFileAtomic(this.file(), `${JSON.stringify(contents, null, 2)}\n`))
    return this.writing
  }

  private scheduleSave(): void {
    this.dirty = true
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.flush().catch((error: unknown) => console.error('Saving window state failed:', error))
    }, SAVE_DELAY_MS)
  }
}

export const windowStateStore = new WindowStateStore(() => app.getPath('userData'))
