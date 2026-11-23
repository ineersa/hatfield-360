import { sep } from 'node:path'

/**
 * electron-builder drops *.d.ts from node_modules; TypeScript's native language server reads its
 * standard library (lib/*.d.ts) from beside its binary, so those are kept.
 * @param {string} file
 * @returns {boolean}
 */
export const onNodeModuleFile = (file) =>
  file.includes(`${sep}@typescript${sep}`) && file.endsWith('.d.ts')
