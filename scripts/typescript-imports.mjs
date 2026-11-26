// Lets Node run the app's TypeScript modules directly: their relative imports have no extension.
import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      try {
        return nextResolve(`${specifier}.ts`, context)
      } catch {
        // Not a TypeScript module; resolved as written below.
      }
    }
    return nextResolve(specifier, context)
  }
})
