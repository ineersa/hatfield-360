/** A JSON object (not null, not an array), for validating data that crossed a trust boundary. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
