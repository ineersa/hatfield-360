import {
  LANGUAGE_SERVER_CHANNELS,
  type LanguageServerConnectResult
} from '../../shared/language-server-api'
import { app } from 'electron'
import { join, relative } from 'node:path'
import { fileRoots } from '../files/file-roots'
import { realpath } from 'node:fs/promises'
import { isPathInside, resolveInsideRoots } from '../files/path-containment'
import {
  allLibraryRoots,
  libraryRoots,
  serverForLanguage
} from '../language-servers/language-server-registry'
import { multiRepoServerRoot } from '../language-servers/language-server-root'
import { languageServerSessions } from '../language-servers/language-server-sessions'
import { worktreeStore } from '../git/worktree-store'
import { handleTrusted } from './trusted-ipc'

const LANGUAGE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i

/** Each workspace folder with where it really is. */
const realFolders = (folders: string[]) =>
  Promise.all(
    folders.map(async (folder) => ({ folder, real: await realpath(folder).catch(() => folder) }))
  )

/**
 * One server per workspace folder, as in VS Code: it finds the projects inside it itself. A
 * multi-repo folder gets one per repository instead, so opening a file indexes only its repository.
 */
async function serverRoot(
  folder: string,
  realFolder: string,
  file: string
): Promise<string | null> {
  const project = worktreeStore.view().find((each) => each.folder === folder)
  if (project?.repositories === undefined) return folder
  const trees = project.repositories.flatMap((repository) =>
    repository.status === 'git'
      ? repository.worktrees.filter((tree) => !tree.prunable).map((tree) => tree.path)
      : [repository.folder]
  )
  const real = await Promise.all(trees.map((tree) => realpath(tree).catch(() => tree)))
  const root = multiRepoServerRoot(file, realFolder, real)
  // Named through the workspace folder, so the server stops with it as the others do.
  return root !== null && isPathInside(root, realFolder)
    ? join(folder, relative(realFolder, root))
    : root
}

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
        if (library === null) return { kind: 'outside' }
        const connection = languageServerSessions.running(event.sender, definition.name)
        return connection === null ? { kind: 'none' } : { kind: 'connected', connection }
      }
      const { folder } = inside
      const root = await serverRoot(folder, inside.real, real)
      if (root === null) return { kind: 'none' }
      const command = await definition.command()
      if ('missing' in command)
        return { kind: 'missing', server: definition.name, message: command.missing }
      const configuration =
        (await definition.configure?.(root, join(app.getPath('userData'), 'language-servers'))) ??
        {}
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
