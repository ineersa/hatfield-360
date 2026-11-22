// The whole editor: every editor feature, language and language service, with Monaco's own workers.
import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker'
import CssWorker from 'monaco-editor/language/css/css.worker.js?worker'
import HtmlWorker from 'monaco-editor/language/html/html.worker.js?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker.js?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker.js?worker'

// Monaco's Vite setup: Vite's build would inline the editor worker's entry as a data: URL that can't
// load the modules it imports. Monaco asks here for every worker, by its language or `editorWorkerService`.
const WORKERS: Record<string, new () => Worker> = {
  json: JsonWorker,
  css: CssWorker,
  scss: CssWorker,
  less: CssWorker,
  html: HtmlWorker,
  handlebars: HtmlWorker,
  razor: HtmlWorker,
  typescript: TsWorker,
  javascript: TsWorker
}
globalThis.MonacoEnvironment = {
  getWorker: (_id, label) => new (WORKERS[label] ?? EditorWorker)()
}

// The worker can't see the project's dependencies or tsconfig, so its type errors would all be false.
for (const defaults of [
  monaco.typescript.typescriptDefaults,
  monaco.typescript.javascriptDefaults
]) {
  defaults.setDiagnosticsOptions({ noSemanticValidation: true })
}

export { monaco }
