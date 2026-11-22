// The editor on VS Code's own services: TextMate grammars, VS Code themes and configuration.
import { getService, initialize, IWorkbenchThemeService } from '@codingame/monaco-vscode-api'
import EditorWorker from '@codingame/monaco-vscode-api/workers/editor.worker?worker'
import getConfigurationServiceOverride from '@codingame/monaco-vscode-configuration-service-override'
import {
  registerExtension,
  type RegisterExtensionResult
} from '@codingame/monaco-vscode-api/extensions'
import getFilesServiceOverride, {
  RegisteredMemoryFile,
  registerExtensionFile
} from '@codingame/monaco-vscode-files-service-override'
import getLanguagesServiceOverride from '@codingame/monaco-vscode-languages-service-override'
import getModelServiceOverride from '@codingame/monaco-vscode-model-service-override'
import getTextmateServiceOverride from '@codingame/monaco-vscode-textmate-service-override'
import TextMateWorker from '@codingame/monaco-vscode-textmate-service-override/worker?worker'
import getThemeServiceOverride from '@codingame/monaco-vscode-theme-service-override'
import { whenReady as batReady } from '@codingame/monaco-vscode-bat-default-extension'
import { whenReady as cppReady } from '@codingame/monaco-vscode-cpp-default-extension'
import { whenReady as csharpReady } from '@codingame/monaco-vscode-csharp-default-extension'
import { whenReady as cssReady } from '@codingame/monaco-vscode-css-default-extension'
import { whenReady as diffReady } from '@codingame/monaco-vscode-diff-default-extension'
import { whenReady as dockerReady } from '@codingame/monaco-vscode-docker-default-extension'
import { whenReady as goReady } from '@codingame/monaco-vscode-go-default-extension'
import { whenReady as htmlReady } from '@codingame/monaco-vscode-html-default-extension'
import { whenReady as iniReady } from '@codingame/monaco-vscode-ini-default-extension'
import { whenReady as javaReady } from '@codingame/monaco-vscode-java-default-extension'
import { whenReady as javascriptReady } from '@codingame/monaco-vscode-javascript-default-extension'
import { whenReady as jsonReady } from '@codingame/monaco-vscode-json-default-extension'
import { whenReady as lessReady } from '@codingame/monaco-vscode-less-default-extension'
import { whenReady as logReady } from '@codingame/monaco-vscode-log-default-extension'
import { whenReady as luaReady } from '@codingame/monaco-vscode-lua-default-extension'
import { whenReady as makeReady } from '@codingame/monaco-vscode-make-default-extension'
import { whenReady as markdownBasicsReady } from '@codingame/monaco-vscode-markdown-basics-default-extension'
import { whenReady as phpReady } from '@codingame/monaco-vscode-php-default-extension'
import { whenReady as powershellReady } from '@codingame/monaco-vscode-powershell-default-extension'
import { whenReady as pythonReady } from '@codingame/monaco-vscode-python-default-extension'
import { whenReady as rubyReady } from '@codingame/monaco-vscode-ruby-default-extension'
import { whenReady as rustReady } from '@codingame/monaco-vscode-rust-default-extension'
import { whenReady as scssReady } from '@codingame/monaco-vscode-scss-default-extension'
import { whenReady as shellscriptReady } from '@codingame/monaco-vscode-shellscript-default-extension'
import { whenReady as sqlReady } from '@codingame/monaco-vscode-sql-default-extension'
import { whenReady as typescriptBasicsReady } from '@codingame/monaco-vscode-typescript-basics-default-extension'
import { whenReady as xmlReady } from '@codingame/monaco-vscode-xml-default-extension'
import { whenReady as yamlReady } from '@codingame/monaco-vscode-yaml-default-extension'
import * as monaco from 'monaco-editor'
import type { ColorTheme } from './editor-color-theme'

// Vite's ?worker imports, so the build emits each worker as its own file (a data: URL can't load imports).
const WORKERS: Record<string, new () => Worker> = { TextMateWorker }
globalThis.MonacoEnvironment = {
  getWorker: (_id, label) => new (WORKERS[label] ?? EditorWorker)()
}

await initialize({
  ...getFilesServiceOverride(),
  ...getConfigurationServiceOverride(),
  ...getModelServiceOverride(),
  ...getLanguagesServiceOverride(),
  ...getThemeServiceOverride(),
  ...getTextmateServiceOverride()
})
// VS Code's grammars and language definitions, registered before the first file opens.
await Promise.all([
  batReady(),
  cppReady(),
  csharpReady(),
  cssReady(),
  diffReady(),
  dockerReady(),
  goReady(),
  htmlReady(),
  iniReady(),
  javaReady(),
  javascriptReady(),
  jsonReady(),
  lessReady(),
  logReady(),
  luaReady(),
  makeReady(),
  markdownBasicsReady(),
  phpReady(),
  powershellReady(),
  pythonReady(),
  rubyReady(),
  rustReady(),
  scssReady(),
  shellscriptReady(),
  sqlReady(),
  typescriptBasicsReady(),
  xmlReady(),
  yamlReady()
])

let theme: { extension: RegisterExtensionResult; count: number } | undefined
let themeQueue: Promise<void> = Promise.resolve()

/**
 * Makes `contents` (a VS Code colour theme file), called `label`, the editor's theme. It is registered as an
 * extension's theme, served from memory, and replaces the one set before.
 */
export function setColorTheme(label: string, contents: ColorTheme): Promise<void> {
  // One at a time, so a quick switch never ends on the theme set first.
  themeQueue = themeQueue.catch(() => undefined).then(() => registerColorTheme(label, contents))
  return themeQueue
}

async function registerColorTheme(label: string, contents: ColorTheme): Promise<void> {
  const count = (theme?.count ?? 0) + 1
  const id = `scheme-${count}`
  const extension = registerExtension(
    {
      name: id,
      publisher: 'hatfield',
      version: '1.0.0',
      engines: { vscode: '*' },
      contributes: {
        themes: [
          {
            id,
            label,
            uiTheme: contents.type === 'dark' ? 'vs-dark' : 'vs',
            path: './theme.json'
          }
        ]
      }
    },
    undefined,
    { system: true }
  )
  registerExtensionFile(
    new RegisteredMemoryFile(
      monaco.Uri.from({
        scheme: 'extension-file',
        authority: extension.id,
        path: '/extension/theme.json'
      }),
      JSON.stringify(contents)
    )
  )
  await extension.whenReady()
  const service = await getService(IWorkbenchThemeService)
  const registered = (await service.getColorThemes()).find((each) => each.settingsId === id)
  if (!registered) throw new Error(`The editor theme ${id} wasn't registered`)
  // Resolves once the theme is applied; not saved to any settings.
  await service.setColorTheme(registered, undefined)
  const previous = theme
  theme = { extension, count }
  await previous?.extension.dispose()
}

export { monaco }
