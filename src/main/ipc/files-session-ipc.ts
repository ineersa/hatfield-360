import { FILES_SESSION_CHANNELS } from '../../shared/files-session-api'
import { parseFilesSession } from '../files/files-session-document'
import { filesSessionStore } from '../files/files-session-store'
import { handleTrusted } from './trusted-ipc'

function workspaceKey(value: unknown): string | null {
  if (value === null || (typeof value === 'string' && value !== '')) return value
  throw new Error('Invalid workspace')
}

export function registerFilesSessionIpc(): void {
  handleTrusted(FILES_SESSION_CHANNELS.get, (_event, workspace) =>
    filesSessionStore.session(workspaceKey(workspace))
  )

  handleTrusted(FILES_SESSION_CHANNELS.save, async (_event, workspace, value) => {
    const session = parseFilesSession(value)
    if (!session) throw new Error('Invalid Files session')
    await filesSessionStore.save(workspaceKey(workspace), session)
  })
}
