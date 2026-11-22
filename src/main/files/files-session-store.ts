import { app } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { EMPTY_FILES_SESSION, type FilesSession } from '../../shared/files-session-api'
import { writeFileAtomic } from './atomic-write'
import { DEFAULT_WORKSPACE_KEY, parseFilesSessions, withSession } from './files-session-document'

const FILE_NAME = 'files-sessions.json'
const VERSION = 1
/** The cursor moves often; the file is written once it settles (and on quit). */
const SAVE_DELAY_MS = 500

/** `userData/files-sessions.json`: each workspace's Files view as it was left. App-owned state. */
class FilesSessionStore {
  private sessions: [string, FilesSession][] = []
  private loaded: Promise<void> | null = null
  private saveTimer: NodeJS.Timeout | null = null
  private dirty = false
  /** Serializes writes so an older one never lands after a newer one. */
  private writing: Promise<void> = Promise.resolve()

  constructor(private readonly dataDir: () => string) {}

  private file(): string {
    return join(this.dataDir(), FILE_NAME)
  }

  /** Reads the file once; a missing or damaged one just means nothing to restore. */
  private load(): Promise<void> {
    this.loaded ??= readFile(this.file(), 'utf8')
      .then((text) => {
        this.sessions = parseFilesSessions(JSON.parse(text))
      })
      .catch(() => undefined)
    return this.loaded
  }

  async session(workspace: string | null): Promise<FilesSession> {
    await this.load()
    const key = workspace ?? DEFAULT_WORKSPACE_KEY
    return this.sessions.find(([other]) => other === key)?.[1] ?? EMPTY_FILES_SESSION
  }

  async save(workspace: string | null, session: FilesSession): Promise<void> {
    await this.load()
    this.sessions = withSession(this.sessions, workspace ?? DEFAULT_WORKSPACE_KEY, session)
    this.dirty = true
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.flush().catch((error: unknown) => console.error('Saving Files sessions failed:', error))
    }, SAVE_DELAY_MS)
  }

  /** Writes pending changes now; called on quit. */
  flush(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    if (!this.dirty) return this.writing
    this.dirty = false
    const contents = {
      version: VERSION,
      sessions: this.sessions.map(([workspace, session]) => ({ workspace, session }))
    }
    this.writing = this.writing
      .catch(() => undefined)
      .then(() => writeFileAtomic(this.file(), `${JSON.stringify(contents)}\n`))
    return this.writing
  }
}

export const filesSessionStore = new FilesSessionStore(() => app.getPath('userData'))
