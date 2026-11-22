// The whole editor: every editor feature, language and language service, with Monaco's own workers.
import * as monaco from 'monaco-editor'

// The worker can't see the project's dependencies or tsconfig, so its type errors would all be false.
for (const defaults of [
  monaco.typescript.typescriptDefaults,
  monaco.typescript.javascriptDefaults
]) {
  defaults.setDiagnosticsOptions({ noSemanticValidation: true })
}

export { monaco }
