import {
  LANGUAGE_SERVER_CHANNELS,
  type LanguageServerConnectResult
} from '../../shared/language-server-api'
import { fileRoots } from '../files/file-roots'
import { isPathInside, resolveInsideRoots } from '../files/path-containment'
import { serverForLanguage } from '../language-servers/language-server-registry'
import { languageServerSessions } from '../language-servers/language-server-sessions'
import { projectRoot } from '../language-servers/project-root'
import { handleTrusted } from './trusted-ipc'

const LANGUAGE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i

const rootPaths = async (): Promise<string[]> =>
  (await fileRoots.current()).map((root) => root.path)

export function registerLanguageServerIpc(): void {
  fileRoots.onChange(() => {
    void rootPaths().then((folders) => languageServerSessions.keepInside(folders))
  })

  handleTrusted(
    LANGUAGE_SERVER_CHANNELS.connect,
    async (event, path, languageId): Promise<LanguageServerConnectResult> => {
      if (
        typeof path !== 'string' ||
        typeof languageId !== 'string' ||
        !LANGUAGE_ID.test(languageId)
      )
        throw new Error('Expected a file path and a language id')
      const definition = serverForLanguage(languageId)
      if (!definition) return { kind: 'none' }
      const folders = await rootPaths()
      const real = await resolveInsideRoots(path, folders)
      const folder = real === null ? undefined : folders.find((each) => isPathInside(real, each))
      if (real === null || folder === undefined)
        throw new Error(`${path} isn't in a workspace folder`)
      const command = await definition.command()
      if ('missing' in command)
        return { kind: 'missing', server: definition.name, message: command.missing }
      const root = await projectRoot(real, folder, definition.rootMarkers)
      return {
        kind: 'connected',
        connection: languageServerSessions.connect(event.sender, definition, command, root)
      }
    }
  )

  handleTrusted(LANGUAGE_SERVER_CHANNELS.send, async (event, id, message) => {
    if (typeof id !== 'string') throw new Error('Expected a language server connection id')
    await languageServerSessions.send(event.sender, id, message, await rootPaths())
  })

  handleTrusted(LANGUAGE_SERVER_CHANNELS.disconnect, (event, id) => {
    if (typeof id !== 'string') throw new Error('Expected a language server connection id')
    return languageServerSessions.disconnect(event.sender, id)
  })
}
