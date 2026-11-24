import { app } from 'electron'
import { type FSWatcher, watch } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { KeybindingsView, UserKeybinding } from '../../shared/keybindings-api'
import { keybindingsTemplate } from '../../shared/keybindings-template'
import type { Notice } from '../../shared/notice'
import { parseKeybindings } from './keybindings-document'

type ChangeListener = (view: KeybindingsView) => void

const KEYBINDINGS_FILE_NAME = 'keybindings.json'
/** Editors save in bursts (write temp, rename, chmod); reload once they are done. */
const RELOAD_DELAY_MS = 75

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

/** The user's keybindings.json, reloaded and pushed to windows whenever the file changes. */
class KeybindingsStore {
  private entries: UserKeybinding[] = []
  private notice: Notice | null = null
  private noticeCount = 0
  /** The file contents last applied; a save that changes nothing is not pushed again. */
  private appliedText: string | null = null
  private loaded: Promise<void> | null = null
  /** Serializes reloads so an older read never overwrites a newer one. */
  private queue: Promise<void> = Promise.resolve()
  private watcher: FSWatcher | null = null
  private reloadTimer: NodeJS.Timeout | null = null
  private readonly listeners = new Set<ChangeListener>()

  constructor(private readonly dataDir: () => string) {}

  file(): string {
    return join(this.dataDir(), KEYBINDINGS_FILE_NAME)
  }

  onChange(listener: ChangeListener): void {
    this.listeners.add(listener)
  }

  async view(): Promise<KeybindingsView> {
    // A failed first read (e.g. keybindings.json is a folder) is retried next time instead of cached.
    this.loaded ??= this.enqueue(() => this.reload()).catch((error: unknown) => {
      this.loaded = null
      throw error
    })
    await this.loaded
    return this.snapshot()
  }

  /** Follows saves to keybindings.json. The folder is watched, since editors often save by replacing the file. */
  async watch(): Promise<void> {
    if (this.watcher) return
    await mkdir(this.dataDir(), { recursive: true })
    this.watcher = watch(this.dataDir(), (_event, name) => {
      // Some platforms don't report the name; reloading an unchanged file is a no-op.
      if (name !== null && name !== KEYBINDINGS_FILE_NAME) return
      if (this.reloadTimer) clearTimeout(this.reloadTimer)
      this.reloadTimer = setTimeout(() => {
        this.reloadTimer = null
        this.enqueue(() => this.reload()).catch((error: unknown) => this.report(error))
      }, RELOAD_DELAY_MS)
    })
    this.watcher.on('error', (error) => console.error('Watching keybindings.json failed:', error))
  }

  /** Creates keybindings.json with every default key commented out when it doesn't exist yet; returns its path. */
  async ensureFile(): Promise<string> {
    const file = this.file()
    await mkdir(this.dataDir(), { recursive: true })
    try {
      // `wx` never replaces a file the user created in the meantime.
      await writeFile(file, keybindingsTemplate(process.platform), { encoding: 'utf8', flag: 'wx' })
    } catch (error) {
      if (!hasCode(error, 'EEXIST')) throw error
    }
    return file
  }

  /** Shows a failure about keybindings in the window. */
  report(error: unknown): Promise<void> {
    return this.enqueue(() => {
      this.setNotice(message(error))
      this.publish()
      return Promise.resolve()
    })
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(task)
    this.queue = run.catch(() => undefined)
    return run
  }

  private async readText(): Promise<string> {
    try {
      return await readFile(this.file(), 'utf8')
    } catch (error) {
      // No file means every key is at its default.
      if (!hasCode(error, 'ENOENT')) throw error
      return ''
    }
  }

  private async reload(): Promise<void> {
    const text = await this.readText()
    if (text === this.appliedText) return
    this.appliedText = text
    const { entries, problems } = parseKeybindings(text, process.platform)
    // A half-typed edit that doesn't parse keeps the keys in force.
    if (entries !== null) this.entries = entries
    if (problems.length > 0) this.setNotice(problems.join(' '))
    else this.notice = null
    this.publish()
  }

  private setNotice(text: string): void {
    this.noticeCount += 1
    this.notice = { id: this.noticeCount, message: text }
  }

  private snapshot(): KeybindingsView {
    return { entries: this.entries, notice: this.notice }
  }

  private publish(): void {
    const view = this.snapshot()
    for (const listener of this.listeners) listener(view)
  }
}

export const keybindingsStore = new KeybindingsStore(() => app.getPath('userData'))
