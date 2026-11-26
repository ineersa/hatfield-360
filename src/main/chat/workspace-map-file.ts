import { access, readFile } from 'node:fs/promises'
import { writeFileAtomic } from '../files/atomic-write'
import {
  appendToPlaybook,
  instructionsForPrompt,
  mapBlockFromReply,
  replaceSection
} from './workspace-map-document'

const readText = (file: string): Promise<string> =>
  readFile(file, 'utf8').catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return ''
    throw error
  })

/**
 * The workspace's map file: the user's text plus the sections main writes. Claude never writes it;
 * main changes only its own sections, one change at a time.
 */
export class WorkspaceMapFile {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(readonly file: string) {}

  /** The file as the chat's instructions; empty when it is missing. */
  async instructions(): Promise<string> {
    return instructionsForPrompt(await readText(this.file))
  }

  /** Replaces the workspace block with the map turn's reply; returns the file written. */
  writeMap(reply: string): Promise<string> {
    return this.change(async (text) =>
      replaceSection(text, 'workspace', mapBlockFromReply(reply))
    ).then(() => this.file)
  }

  /** Adds an entry to the playbook; false when the playbook is full. */
  async saveToPlaybook(entry: string): Promise<boolean> {
    let saved = false
    await this.change(async (text) => {
      const appended = appendToPlaybook(text, entry)
      if (appended.status === 'full') return null
      saved = true
      return appended.text
    })
    return saved
  }

  /** Creates the file empty when missing, so the editor can open it. */
  async ensure(): Promise<string> {
    await this.serialized(async () => {
      const exists = await access(this.file).then(
        () => true,
        () => false
      )
      if (!exists) await writeFileAtomic(this.file, '')
    })
    return this.file
  }

  private change(apply: (text: string) => Promise<string | null>): Promise<void> {
    return this.serialized(async () => {
      const text = await readText(this.file)
      const next = await apply(text)
      if (next !== null && next !== text) await writeFileAtomic(this.file, next)
    })
  }

  private serialized(work: () => Promise<void>): Promise<void> {
    const run = this.queue.then(work)
    this.queue = run.catch(() => undefined)
    return run
  }
}
