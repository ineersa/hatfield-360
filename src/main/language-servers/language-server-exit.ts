type ServerExit = {
  /** Why main stopped the server as failed (it refused to start), if it did. */
  refused: string | null
  /** Main asked the server to shut down before it exited. */
  requested: boolean
  code: number | null
  signal: NodeJS.Signals | null
}

/**
 * Why a server that exited failed, or null for a shutdown main asked for. Only main ever stops a
 * server, so any other exit, even with code 0, is a failure.
 */
export function exitFailure(server: string, exit: ServerExit): string | null {
  if (exit.refused !== null) return exit.refused
  if (exit.requested) return null
  const how = exit.signal ? `was killed (${exit.signal})` : `exited with code ${String(exit.code)}`
  return `The ${server} language server ${how}.`
}

/** Longer stderr lines are source a crash dumped (a whole minified bundle), not a message. */
const MAX_LINE = 500

/** The failure notice: what happened, the server's last stderr lines and where its full log is. */
export function failureNotice(failure: string, stderr: readonly string[], logPath: string): string {
  const lines = stderr.map((line) =>
    line.length > MAX_LINE ? `[a ${String(line.length)}-character line, left out]` : line
  )
  return [failure, ...lines, `Full log: ${logPath}`].join('\n')
}
