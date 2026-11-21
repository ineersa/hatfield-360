// The whole editor: every editor feature, language and language service.
import * as monaco from 'monaco-editor'

// Every worker is a bundled file from the app's own origin: left to itself, Monaco starts the editor
// worker from a blob: URL, which the CSP (`script-src 'self'`) refuses. Vite bundles a worker only
// from the literal `new Worker(new URL(...))` form, and files named like Monaco's own are shared.
self.MonacoEnvironment = {
  getWorker: (_workerId, label) => {
    switch (label) {
      case 'json':
        return new Worker(new URL('./workers/json.worker.ts', import.meta.url), { type: 'module' })
      case 'css':
      case 'scss':
      case 'less':
        return new Worker(new URL('./workers/css.worker.ts', import.meta.url), { type: 'module' })
      case 'html':
      case 'handlebars':
      case 'razor':
        return new Worker(new URL('./workers/html.worker.ts', import.meta.url), { type: 'module' })
      case 'typescript':
      case 'javascript':
        return new Worker(new URL('./workers/ts.worker.ts', import.meta.url), {
          type: 'module'
        })
      default:
        return new Worker(new URL('./workers/editor.worker.ts', import.meta.url), {
          type: 'module'
        })
    }
  }
}

// The worker can't see the project's dependencies or tsconfig, so its type errors would all be false.
for (const defaults of [
  monaco.typescript.typescriptDefaults,
  monaco.typescript.javascriptDefaults
]) {
  defaults.setDiagnosticsOptions({ noSemanticValidation: true })
}

export { monaco }
