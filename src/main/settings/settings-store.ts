import { app } from 'electron'
import { type FSWatcher, watch } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Notice } from '../../shared/notice'
import {
  DEFAULT_SETTINGS,
  type SettingKey,
  type Settings,
  type SettingsView
} from '../../shared/settings-api'
import { writeFileAtomic } from '../files/atomic-write'
import { checkSettingValue, parseSettings, withSetting } from './settings-document'

type ChangeListener = (view: SettingsView) => void

const SETTINGS_FILE_NAME = 'settings.json'
/** Editors save in bursts (write temp, rename, chmod); reload once they are done. */
const RELOAD_DELAY_MS = 75

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

/** The user's settings.json, reloaded and pushed to windows whenever the file changes. */
class SettingsStore {
  private values: Settings = DEFAULT_SETTINGS
  private customized: SettingKey[] = []
  private editable = true
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
    return join(this.dataDir(), SETTINGS_FILE_NAME)
  }

  onChange(listener: ChangeListener): void {
    this.listeners.add(listener)
  }

  async view(): Promise<SettingsView> {
    // A failed first read (e.g. settings.json is a folder) is retried next time instead of cached.
    this.loaded ??= this.enqueue(() => this.reload()).catch((error: unknown) => {
      this.loaded = null
      throw error
    })
    await this.loaded
    return this.snapshot()
  }

  /** Writes one setting into settings.json (null resets it) and applies it right away. */
  update(key: SettingKey, value: unknown): Promise<void> {
    return this.enqueue(async () => {
      const checked = value === null ? null : checkSettingValue(key, value)
      const text = await this.readText()
      if (!parseSettings(text, this.values).editable) {
        throw new Error(
          'settings.json has errors. Fix them in the file first (Open settings.json).'
        )
      }
      await writeFileAtomic(this.file(), withSetting(text, key, checked))
      // The watcher would pick this up too; reloading now keeps the page in step with the write.
      await this.reload()
    })
  }

  /** Follows saves to settings.json. The folder is watched, since editors often save by replacing the file. */
  async watch(): Promise<void> {
    if (this.watcher) return
    await mkdir(this.dataDir(), { recursive: true })
    this.watcher = watch(this.dataDir(), (_event, name) => {
      // Some platforms don't report the name; reloading an unchanged file is a no-op.
      if (name !== null && name !== SETTINGS_FILE_NAME) return
      if (this.reloadTimer) clearTimeout(this.reloadTimer)
      this.reloadTimer = setTimeout(() => {
        this.reloadTimer = null
        this.enqueue(() => this.reload()).catch((error: unknown) => this.report(error))
      }, RELOAD_DELAY_MS)
    })
    this.watcher.on('error', (error) => console.error('Watching settings.json failed:', error))
  }

  /** Creates settings.json as `{}` when it doesn't exist yet; returns its path. */
  async ensureFile(): Promise<string> {
    const file = this.file()
    await mkdir(this.dataDir(), { recursive: true })
    try {
      // `wx` never replaces a file the user created in the meantime.
      await writeFile(file, '{}\n', { encoding: 'utf8', flag: 'wx' })
    } catch (error) {
      if (!hasCode(error, 'EEXIST')) throw error
    }
    return file
  }

  /** Shows a failure about settings (e.g. opening the file) in the window. */
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
      // No file means every setting is at its default.
      if (!hasCode(error, 'ENOENT')) throw error
      return ''
    }
  }

  private async reload(): Promise<void> {
    const text = await this.readText()
    if (text === this.appliedText) return
    this.appliedText = text
    const { values, customized, editable, problems } = parseSettings(text, this.values)
    this.values = values
    this.customized = customized
    this.editable = editable
    if (problems.length > 0) this.setNotice(`Settings: ${problems.join(' ')}`)
    else this.notice = null
    this.publish()
  }

  private setNotice(text: string): void {
    this.noticeCount += 1
    this.notice = { id: this.noticeCount, message: text }
  }

  private snapshot(): SettingsView {
    return {
      values: this.values,
      customized: this.customized,
      editable: this.editable,
      notice: this.notice
    }
  }

  private publish(): void {
    const view = this.snapshot()
    for (const listener of this.listeners) listener(view)
  }
}

export const settingsStore = new SettingsStore(() => app.getPath('userData'))
