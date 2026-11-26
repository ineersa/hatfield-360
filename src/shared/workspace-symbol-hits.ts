import {
  compareMatches,
  type FuzzyMatch,
  fuzzyPathMatch,
  type MatchRanges
} from './fuzzy-path-match'

/** A symbol a language server's `workspace/symbol` returned, with its file as a path. */
export type WorkspaceSymbol = {
  name: string
  /** LSP's `SymbolKind`. */
  kind: number
  container: string | null
  path: string
  /** From 1; null when the server gave the file only. */
  line: number | null
  column: number | null
}

export type SymbolHit = WorkspaceSymbol & { score: number; ranges: MatchRanges }

/** The most symbols one query lists. */
const SYMBOL_HIT_LIMIT = 50

/** LSP's class-like kinds: Class, Enum, Interface, Struct; Go to Class lists only these. */
const CLASS_KINDS = new Set([5, 10, 11, 23])

export const isClassKind = (kind: number): boolean => CLASS_KINDS.has(kind)

/** `Container::member`, `Container.member` or `Container#member`: the member part after the last one. */
const SEPARATOR = /::|[.#]|->/g

function split(query: string): { container: string; member: string } {
  const parts = query.split(SEPARATOR)
  const member = parts.pop() ?? ''
  return { container: parts.join(''), member }
}

/** `member` in the symbol's name, inside a container matching `container` when one was typed. */
function splitMatch(container: string, member: string, symbol: WorkspaceSymbol): FuzzyMatch | null {
  const name = fuzzyPathMatch(member, symbol.name)
  if (name === null || container === '') return name
  const inside = symbol.container === null ? null : fuzzyPathMatch(container, symbol.container)
  return inside === null ? null : { score: name.score + inside.score, ranges: name.ranges }
}

const bestOf = (a: FuzzyMatch | null, b: FuzzyMatch | null): FuzzyMatch | null =>
  a === null ? b : b === null || a.score >= b.score ? a : b

/**
 * Every server's symbols for `query`, merged: each one once (two servers, or one twice), ranked by
 * how well its name matches, best first. `RunMessageProcessor::process` matches `process` in a
 * container matching `RunMessageProcessor`, or a name that is itself qualified, as gopls gives
 * methods (`RunMessageProcessor.Process`, the package as container). `classesOnly` keeps the class-like kinds.
 */
export function rankSymbols(
  query: string,
  lists: readonly (readonly WorkspaceSymbol[])[],
  classesOnly = false
): SymbolHit[] {
  const whole = query.trim()
  const { container, member } = split(whole)
  const seen = new Set<string>()
  const hits: SymbolHit[] = []
  for (const symbol of lists.flat()) {
    if (classesOnly && !isClassKind(symbol.kind)) continue
    const key = [symbol.path, symbol.line, symbol.column, symbol.name, symbol.kind].join('\0')
    if (seen.has(key)) continue
    seen.add(key)
    const match = bestOf(splitMatch(container, member, symbol), fuzzyPathMatch(whole, symbol.name))
    if (match !== null) hits.push({ ...symbol, ...match })
  }
  return hits
    .toSorted((a, b) => compareMatches({ ...a, text: a.name }, { ...b, text: b.name }))
    .slice(0, SYMBOL_HIT_LIMIT)
}
