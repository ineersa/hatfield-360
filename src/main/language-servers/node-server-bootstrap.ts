/**
 * Runs the server script (argv[1], as Node would see it) after installing handlers that print an
 * uncaught error's stack: Node itself prints only the throwing source line, which for a bundled
 * server is the whole minified bundle, and leaves the error out. Written synchronously so it lands
 * before the exit.
 */
const BOOTSTRAP = `
const { writeSync } = require('node:fs')
const { inspect } = require('node:util')
const report = (kind) => (error) => {
  try {
    writeSync(2, '\\n' + kind + ': ' + (error instanceof Error && error.stack ? error.stack : inspect(error)) + '\\n')
  } finally {
    process.exit(1)
  }
}
process.on('uncaughtException', report('Uncaught exception'))
process.on('unhandledRejection', report('Unhandled rejection'))
require(process.argv[1])
`

/** Node's arguments to run `file` with `args` through the bootstrap. */
export function nodeServerArgs(file: string, args: readonly string[]): string[] {
  return ['-e', BOOTSTRAP, file, ...args]
}
