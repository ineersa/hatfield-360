/** Packaged, native executables run from the unpacked copy: the OS can't execute a file inside an asar. */
export const unpackedPath = (path: string): string =>
  path.replace(/app\.asar([/\\])/, 'app.asar.unpacked$1')
