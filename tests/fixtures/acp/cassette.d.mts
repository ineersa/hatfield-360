type CassetteEntry = { from: 'client' | 'agent'; message: unknown }

export function mapStrings(value: unknown, map: (text: string) => string): unknown
export function normalize(entries: unknown[], paths: { cwd: string; home: string }): CassetteEntry[]
export function parseCassette(text: string): {
  header: { adapter: string; cassette: string }
  entries: CassetteEntry[]
}
export function serializeCassette(header: object, entries: CassetteEntry[]): string
export class Bindings {
  constructor(initial: Record<string, string>)
  fill(value: unknown): unknown
  match(recorded: unknown, actual: unknown): boolean
}
