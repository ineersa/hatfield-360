import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'

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
  /** Files that mark a project's root; the nearest folder holding one is the server's root. */
  rootMarkers: string[]
  /** The command, or why it isn't available and how to install it. */
  command: () => Promise<ServerCommand | { missing: string }>
  /** Worked out by main for each start, never taken from the page. */
  configure?: (root: string) => Promise<ServerConfiguration>
}

const fixed = (configuration: ServerConfiguration) => (): Promise<ServerConfiguration> =>
  Promise.resolve(configuration)

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false
  )

/** The project's virtualenv interpreter (`.venv` or `venv` in its root), if it has one. */
async function virtualenvPython(root: string): Promise<string | undefined> {
  const executable =
    process.platform === 'win32' ? join('Scripts', 'python.exe') : join('bin', 'python')
  for (const folder of ['.venv', 'venv']) {
    const python = join(root, folder, executable)
    if (await exists(python)) return python
  }
  return undefined
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

// Packaged, native executables run from the unpacked copy: the OS can't execute a file inside an asar.
const unpacked = (path: string): string => path.replace(/app\.asar([/\\])/, 'app.asar.unpacked$1')

/** A script run on the app's own Node; `resolve` finds it lazily, as a literal path tools can follow. */
const nodeScript =
  (resolve: () => string, ...args: string[]) =>
  (): Promise<ServerCommand> =>
    Promise.resolve({ file: resolve(), args, node: true })

/** TypeScript 7 is native and has its own language server (`tsc --lsp`). */
async function typescriptCommand(): Promise<ServerCommand | { missing: string }> {
  const name = `@typescript/typescript-${process.platform}-${process.arch}`
  try {
    const fromTypescript = createRequire(require.resolve('typescript/package.json'))
    const folder = dirname(fromTypescript.resolve(`${name}/package.json`))
    const file = unpacked(join(folder, 'lib', process.platform === 'win32' ? 'tsc.exe' : 'tsc'))
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

const LANGUAGE_SERVERS: LanguageServerDefinition[] = [
  {
    name: 'TypeScript',
    languages: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
    rootMarkers: ['tsconfig.json', 'jsconfig.json', 'package.json'],
    command: typescriptCommand
  },
  {
    name: 'JSON',
    languages: ['json', 'jsonc'],
    rootMarkers: ['package.json'],
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
    rootMarkers: ['package.json'],
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
    rootMarkers: ['package.json'],
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
    rootMarkers: [
      'pyproject.toml',
      'setup.py',
      'setup.cfg',
      'requirements.txt',
      'pyrightconfig.json'
    ],
    command: nodeScript(() => require.resolve('basedpyright/langserver.index.js'), '--stdio'),
    configure: async (root) => {
      const pythonPath = await virtualenvPython(root)
      return { settings: { python: pythonPath === undefined ? {} : { pythonPath } } }
    }
  },
  {
    name: 'PHP',
    languages: ['php'],
    rootMarkers: ['composer.json'],
    command: nodeScript(() => require.resolve('intelephense/lib/intelephense.js'), '--stdio'),
    configure: intelephenseConfiguration
  },
  {
    name: 'Go',
    languages: ['go'],
    rootMarkers: ['go.work', 'go.mod'],
    command: onPath(
      'gopls',
      ['serve'],
      'Install it with `go install golang.org/x/tools/gopls@latest`.'
    )
  }
]

export const serverForLanguage = (languageId: string): LanguageServerDefinition | undefined =>
  LANGUAGE_SERVERS.find((server) => server.languages.includes(languageId))
