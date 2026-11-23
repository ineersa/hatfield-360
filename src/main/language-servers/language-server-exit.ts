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
