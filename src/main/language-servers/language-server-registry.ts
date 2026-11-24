import { execFile } from 'node:child_process'
import { unpackedPath } from '../asar-unpacked-path'
import { constants } from 'node:fs'
import { access, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { delimiter, dirname, isAbsolute, join, parse } from 'node:path'
import { promisify } from 'node:util'
import { realRoots } from '../files/path-containment'
import { isPythonLibraryFolder, libraryFoldersBesideHome } from './library-folders'

type JsonObject = Record<string, unknown>

/** What main tells a server when it starts for a project root. */
export type ServerConfiguration = {
  initializationOptions?: JsonObject
  /** Answers to the server's `workspace/configuration` requests, also pushed once it starts. */
  settings?: JsonObject
}

/** How to start a server: a script run on Electron's own Node, or an executable. */
export type ServerCommand = { file: string; args: string[]; node: boolean }

export type LanguageServerDefinition = {
  /** Shown to the user, as in "The PHP language server". */
  name: string
  languages: string[]
  /** The command, or why it isn't available and how to install it. */
  command: () => Promise<ServerCommand | { missing: string }>
  /** Worked out by main for each start (its workspace folder), never taken from the page. */
  configure?: (root: string) => Promise<ServerConfiguration>
  /**
   * Folders outside any project holding the language's own sources (standard library, stubs),
   * which Go to Definition may open read-only.
   */
  librarySources?: () => Promise<string[]>
}

const fixed = (configuration: ServerConfiguration) => (): Promise<ServerConfiguration> =>
  Promise.resolve(configuration)

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false
  )

/**
 * The `site-packages` folders of the project's virtualenv (`.venv` or `venv` in its root), found by
 * listing it. Its interpreter is the repository's own file, so it is never run.
 */
async function virtualenvPackages(root: string): Promise<string[]> {
  for (const folder of ['.venv', 'venv']) {
    const venv = join(root, folder)
    const candidates =
      process.platform === 'win32'
        ? [join(venv, 'Lib', 'site-packages')]
        : (await readdir(join(venv, 'lib')).catch(() => []))
            .filter((name) => /^python\d/.test(name))
            .map((name) => join(venv, 'lib', name, 'site-packages'))
    const present = await Promise.all(candidates.map(exists))
    const found = candidates.filter((_, index) => present[index])
    if (found.length > 0) return found
  }
  return []
}

/** A tool that hangs or waits on the network (a toolchain download) gives up and counts as missing. */
const TOOL_TIMEOUT_MS = 10_000

/**
 * Runs one of the user's tools from the file system's root, never from a folder holding a project
 * (Python would import modules from it), and stops it if it hangs.
 */
const runTool = (file: string, args: string[], env?: NodeJS.ProcessEnv) =>
  promisify(execFile)(file, args, {
    cwd: parse(process.execPath).root,
    timeout: TOOL_TIMEOUT_MS,
    ...(env && { env })
  })

type UserPython = { executable: string; path: string[] }

let userPythonFound: Promise<UserPython | null> | undefined

/** The user's own interpreter (`python3` on PATH) and where it finds modules, asked once per run. */
function userPython(): Promise<UserPython | null> {
  userPythonFound ??= findUserPython()
  return userPythonFound
}

async function findUserPython(): Promise<UserPython | null> {
  for (const python of ['python3', 'python']) {
    try {
      const { stdout } = await runTool(python, [
        '-c',
        'import json, sys; print(json.dumps([sys.executable, sys.path]))'
      ])
      const found: unknown = JSON.parse(stdout)
      const executable: unknown = Array.isArray(found) ? found.at(0) : undefined
      const paths: unknown = Array.isArray(found) ? found.at(1) : undefined
      if (typeof executable !== 'string' || !isAbsolute(executable) || !Array.isArray(paths))
        return null
      const path = paths.filter(
        (each): each is string => typeof each === 'string' && isAbsolute(each)
      )
      return { executable, path }
    } catch {
      // Not installed under this name; the next one may be.
    }
  }
  return null
}

/**
 * Intelephense keeps its own index and finds a key in its global storage folder; a key in
 * `~/intelephense` (`licence.txt` or `license.txt`) is passed as a path, which it reads itself.
 */
async function intelephenseConfiguration(): Promise<ServerConfiguration> {
  const folder = join(homedir(), 'intelephense')
  let licenceKey: string | undefined
  for (const name of ['licence.txt', 'license.txt']) {
    if (await exists(join(folder, name))) {
      licenceKey = join(folder, name)
      break
    }
  }
  return {
    ...(licenceKey === undefined ? {} : { initializationOptions: { licenceKey } }),
    settings: { intelephense: { telemetry: { enabled: false } } }
  }
}

/**
 * A script run on the app's own Node; `resolve` finds it lazily, as a literal path tools can follow.
 * Packaged, a script unpacked from the asar runs from there (basedpyright changes into its own folder).
 */
const nodeScript =
  (resolve: () => string, ...args: string[]) =>
  async (): Promise<ServerCommand> => {
    const file = resolve()
    const real = unpackedPath(file)
    return { file: real !== file && (await exists(real)) ? real : file, args, node: true }
  }

/** A folder inside a bundled package, as the server running from the unpacked copy names it too. */
const packageFolder =
  (resolve: () => string, ...path: string[]) =>
  async (): Promise<string[]> => {
    const folder = join(dirname(resolve()), ...path)
    return [...new Set([folder, unpackedPath(folder)])]
  }

/** The native TypeScript build's `lib` folder: its server and the standard library's `.d.ts` files. */
function typescriptLib(): string {
  const name = `@typescript/typescript-${process.platform}-${process.arch}`
  const fromTypescript = createRequire(require.resolve('typescript/package.json'))
  return unpackedPath(join(dirname(fromTypescript.resolve(`${name}/package.json`)), 'lib'))
}

/** TypeScript 7 is native and has its own language server (`tsc --lsp`). */
async function typescriptCommand(): Promise<ServerCommand | { missing: string }> {
  try {
    const file = join(typescriptLib(), process.platform === 'win32' ? 'tsc.exe' : 'tsc')
    return { file, args: ['--lsp', '--stdio'], node: false }
  } catch {
    return {
      missing: `TypeScript has no language server build for ${process.platform}-${process.arch}.`
    }
  }
}

/** An executable the user installs themselves, found on PATH. */
const onPath =
  (executable: string, args: string[], install: string) =>
  async (): Promise<ServerCommand | { missing: string }> => {
    const names =
      process.platform === 'win32' ? [`${executable}.exe`, `${executable}.cmd`] : [executable]
    for (const folder of (process.env['PATH'] ?? '').split(delimiter).filter(Boolean)) {
      for (const name of names) {
        const file = join(folder, name)
        const found = await access(file, constants.X_OK).then(
          () => true,
          () => false
        )
        if (found) return { file, args, node: false }
      }
    }
    return { missing: `${executable} isn't installed. ${install}` }
  }

/**
 * Where Python finds modules (its standard library, site-packages, `PYTHONPATH`), as the user's
 * `python3` reports it: basedpyright resolves imports there when typeshed has no stub. In home,
 * only Python's own folders count.
 */
async function pythonSources(): Promise<string[]> {
  const python = await userPython()
  if (!python) return []
  const [home = homedir()] = await realRoots([homedir()])
  const folders = await realRoots(python.path)
  return folders.filter((folder) => isPythonLibraryFolder(folder, home))
}

/** Go's standard library and module cache, as the user's `go` reports them; none without Go. */
async function goSources(): Promise<string[]> {
  try {
    // The installed toolchain answers; `go` never downloads another to do it.
    const { stdout } = await runTool('go', ['env', 'GOROOT', 'GOMODCACHE'], {
      ...process.env,
      GOTOOLCHAIN: 'local'
    })
    return stdout.split(/\r?\n/).filter(Boolean)
  } catch {
    return []
  }
}

/**
 * basedpyright runs the interpreter it is given, or else the project's own `.venv/bin/python`: a
 * file from the repository. So it always gets the user's interpreter (or, without one, a venv
 * folder, which stops it looking), and the project's packages as extra import paths.
 */
export async function pythonConfiguration(root: string): Promise<ServerConfiguration> {
  const [python, packages] = await Promise.all([userPython(), virtualenvPackages(root)])
  return {
    settings: {
      python: {
        ...(python ? { pythonPath: python.executable } : { venvPath: root }),
        analysis: { extraPaths: packages }
      }
    }
  }
}

const LANGUAGE_SERVERS: LanguageServerDefinition[] = [
  {
    name: 'TypeScript',
    languages: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
    command: typescriptCommand,
    librarySources: async () => [typescriptLib()]
  },
  {
    name: 'JSON',
    languages: ['json', 'jsonc'],
    command: nodeScript(
      () =>
        require.resolve('vscode-langservers-extracted/lib/json-language-server/node/jsonServerMain.js'),
      '--stdio'
    ),
    // Schemas on other protocols are asked of main, which never downloads them.
    configure: fixed({
      initializationOptions: { provideFormatter: true, handledSchemaProtocols: ['file'] },
      settings: { json: { validate: { enable: true }, format: { enable: true } } }
    })
  },
  {
    name: 'CSS',
    languages: ['css', 'scss', 'less'],
    command: nodeScript(
      () =>
        require.resolve('vscode-langservers-extracted/lib/css-language-server/node/cssServerMain.js'),
      '--stdio'
    ),
    configure: fixed({
      settings: { css: { validate: true }, scss: { validate: true }, less: { validate: true } }
    })
  },
  {
    name: 'HTML',
    languages: ['html'],
    command: nodeScript(
      () =>
        require.resolve('vscode-langservers-extracted/lib/html-language-server/node/htmlServerMain.js'),
      '--stdio'
    ),
    configure: fixed({
      initializationOptions: {
        provideFormatter: true,
        embeddedLanguages: { css: true, javascript: true }
      }
    })
  },
  {
    name: 'Python',
    languages: ['python'],
    command: nodeScript(() => require.resolve('basedpyright/langserver.index.js'), '--stdio'),
    librarySources: async () => [
      ...(await packageFolder(
        () => require.resolve('basedpyright/package.json'),
        'dist',
        'typeshed-fallback'
      )()),
      ...(await pythonSources())
    ],
    configure: (root) => pythonConfiguration(root)
  },
  {
    name: 'PHP',
    languages: ['php'],
    command: nodeScript(() => require.resolve('intelephense/lib/intelephense.js'), '--stdio'),
    librarySources: packageFolder(
      () => require.resolve('intelephense/lib/intelephense.js'),
      'stub'
    ),
    configure: intelephenseConfiguration
  },
  {
    name: 'Go',
    languages: ['go'],
    command: onPath(
      'gopls',
      ['serve'],
      'Install it with `go install golang.org/x/tools/gopls@latest`.'
    ),
    librarySources: goSources
  }
]

const sources = new WeakMap<LanguageServerDefinition, Promise<string[]>>()

/** The server's library folders that exist, as real paths, none home or above it; asked once per run. */
export function libraryRoots(definition: LanguageServerDefinition): Promise<string[]> {
  let found = sources.get(definition)
  if (!found) {
    found = (definition.librarySources?.() ?? Promise.resolve([])).then(
      async (folders) => {
        const [home = homedir()] = await realRoots([homedir()])
        return libraryFoldersBesideHome(await realRoots(folders), home)
      },
      () => []
    )
    sources.set(definition, found)
  }
  return found
}

/** Every server's library folders: the places outside the workspace the editor may read. */
export const allLibraryRoots = async (): Promise<string[]> =>
  (await Promise.all(LANGUAGE_SERVERS.map(libraryRoots))).flat()

export const serverForLanguage = (languageId: string): LanguageServerDefinition | undefined =>
  LANGUAGE_SERVERS.find((server) => server.languages.includes(languageId))
