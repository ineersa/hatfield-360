/** An error from a call to main, without the "Error invoking remote method '<channel>': Error: " prefix Electron adds. */
export function mainErrorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '')
}
