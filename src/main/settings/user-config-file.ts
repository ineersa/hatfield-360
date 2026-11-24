import { type FSWatcher, watch } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Notice } from '../../shared/notice'
import { writeFileAtomic } from '../files/atomic-write'

/** Editors save in bursts (write temp, rename, chmod); reload once they are done. */
const RELOAD_DELAY_MS = 75

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

export type UserConfigFormat<State, View> = {
  /** The file's name in the app data folder, as in `settings.json`. */
  name: string
  /** What is in force before the file is read, and while it doesn't exist. */
  initial: State
  /** The contents the file is first created with. */
  template: () => string
  /** The file's contents read on top of what was in force, and one line per problem. */
  parse: (text: string, previous: State) => { state: State; problems: string[] }
  view: (state: State, notice: Notice | null) => View
}

/** A JSON file the user edits in the app data folder, reloaded and pushed to windows on every change. */
export class UserConfigFile<State, View> {
  protected state: State
  private notice: Notice | null = null
  private noticeCount = 0
  /** The file contents last applied; a save that changes nothing is not pushed again. */
  private appliedText: string | null = null
  private loaded: Promise<void> | null = null
  /** Serializes reloads so an older read never overwrites a newer one. */
  private queue: Promise<void> = Promise.resolve()
  private watcher: FSWatcher | null = null
  private reloadTimer: NodeJS.Timeout | null = null
  private readonly listeners = new Set<(view: View) => void>()

  constructor(
    private readonly format: UserConfigFormat<State, View>,
    private readonly dataDir: () => string
  ) {
    this.state = format.initial
  }

  file(): string {
    return join(this.dataDir(), this.format.name)
  }

  onChange(listener: (view: View) => void): void {
    this.listeners.add(listener)
  }

  async view(): Promise<View> {
    // A failed first read (e.g. the file is a folder) is retried next time instead of cached.
    this.loaded ??= this.enqueue(() => this.reload()).catch((error: unknown) => {
      this.loaded = null
      throw error
    })
    await this.loaded
    return this.snapshot()
  }

  /** Follows saves to the file. The folder is watched, since editors often save by replacing the file. */
  async watch(): Promise<void> {
    if (this.watcher) return
    await mkdir(this.dataDir(), { recursive: true })
    this.watcher = watch(this.dataDir(), (_event, name) => {
      // Some platforms don't report the name; reloading an unchanged file is a no-op.
      if (name !== null && name !== this.format.name) return
      if (this.reloadTimer) clearTimeout(this.reloadTimer)
      this.reloadTimer = setTimeout(() => {
        this.reloadTimer = null
        this.enqueue(() => this.reload()).catch((error: unknown) => this.report(error))
      }, RELOAD_DELAY_MS)
    })
    this.watcher.on('error', (error) =>
      console.error(`Watching ${this.format.name} failed:`, error)
    )
  }

  /** Creates the file from its template when it doesn't exist yet; returns its path. */
  async ensureFile(): Promise<string> {
    const file = this.file()
    await mkdir(this.dataDir(), { recursive: true })
    try {
      // `wx` never replaces a file the user created in the meantime.
      await writeFile(file, this.format.template(), { encoding: 'utf8', flag: 'wx' })
    } catch (error) {
      if (!hasCode(error, 'EEXIST')) throw error
    }
    return file
  }

  /** Shows a failure about this file (e.g. opening it) in the window. */
  report(error: unknown): Promise<void> {
    return this.enqueue(() => {
      this.setNotice(message(error))
      this.publish()
      return Promise.resolve()
    })
  }

  /** Rewrites the file from its current contents and what is in force, then applies it right away. */
  protected rewrite(change: (text: string, state: State) => string): Promise<void> {
    return this.enqueue(async () => {
      const text = await this.readText()
      await writeFileAtomic(this.file(), change(text, this.state))
      // The watcher would pick this up too; reloading now keeps the page in step with the write.
      await this.reload()
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
      // No file means everything is at its default.
      if (!hasCode(error, 'ENOENT')) throw error
      return ''
    }
  }

  private async reload(): Promise<void> {
    const text = await this.readText()
    if (text === this.appliedText) return
    this.appliedText = text
    const { state, problems } = this.format.parse(text, this.state)
    this.state = state
    if (problems.length > 0) this.setNotice(problems.join(' '))
    else this.notice = null
    this.publish()
  }

  private setNotice(text: string): void {
    this.noticeCount += 1
    this.notice = { id: this.noticeCount, message: text }
  }

  private snapshot(): View {
    return this.format.view(this.state, this.notice)
  }

  private publish(): void {
    const view = this.snapshot()
    for (const listener of this.listeners) listener(view)
  }
}
