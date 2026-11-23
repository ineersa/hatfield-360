import {
  LANGUAGE_SERVER_CHANNELS,
  type LanguageServerConnectResult
} from '../../shared/language-server-api'
import { fileRoots } from '../files/file-roots'
import { realpath } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { isPathInside, resolveInsideRoots } from '../files/path-containment'
import {
  allLibraryRoots,
  libraryRoots,
  serverForLanguage
} from '../language-servers/language-server-registry'
import { languageServerSessions } from '../language-servers/language-server-sessions'
import { projectRoot } from '../language-servers/project-root'
import { handleTrusted } from './trusted-ipc'

const LANGUAGE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i

/** Each workspace folder with where it really is. */
const realFolders = (folders: string[]) =>
  Promise.all(
    folders.map(async (folder) => ({ folder, real: await realpath(folder).catch(() => folder) }))
  )

const rootPaths = async (): Promise<string[]> =>
  (await fileRoots.current()).map((root) => root.path)

const readableRoots = async (): Promise<string[]> => [
  ...(await rootPaths()),
  ...(await allLibraryRoots())
]

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
      const realFolder = await realFolders(folders)
      const inside =
        real === null ? undefined : realFolder.find((each) => isPathInside(real, each.real))
      if (real === null || inside === undefined) {
        // A library source a jump opened is served by the page's server it came from, if still running.
        const library = await resolveInsideRoots(path, await libraryRoots(definition))
        if (library === null) throw new Error(`${path} isn't in a workspace folder`)
        const connection = languageServerSessions.running(event.sender, definition.name)
        return connection === null ? { kind: 'none' } : { kind: 'connected', connection }
      }
      const { folder } = inside
      const command = await definition.command()
      if ('missing' in command)
        return { kind: 'missing', server: definition.name, message: command.missing }
      // Found by real paths, but named under the folder as the page knows it (maybe through a link).
      const root = join(
        folder,
        relative(inside.real, await projectRoot(real, inside.real, definition.rootMarkers))
      )
      const configuration = (await definition.configure?.(root)) ?? {}
      return {
        kind: 'connected',
        connection: languageServerSessions.connect(
          event.sender,
          definition,
          command,
          root,
          folder,
          configuration,
          // A library folder overlapping a workspace folder would hand its projects to every client.
          (await libraryRoots(definition)).filter(
            (library) =>
              !realFolder.some(
                (each) => isPathInside(each.real, library) || isPathInside(library, each.real)
              )
          )
        )
      }
    }
  )

  handleTrusted(LANGUAGE_SERVER_CHANNELS.send, async (event, id, message) => {
    if (typeof id !== 'string') throw new Error('Expected a language server connection id')
    // Documents may be in the workspace or in a server's library sources, which open read-only.
    await languageServerSessions.send(event.sender, id, message, readableRoots)
  })

  handleTrusted(LANGUAGE_SERVER_CHANNELS.disconnect, (event, id) => {
    if (typeof id !== 'string') throw new Error('Expected a language server connection id')
    return languageServerSessions.disconnect(event.sender, id)
  })
}
