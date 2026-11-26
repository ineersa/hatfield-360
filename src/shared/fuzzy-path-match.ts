/** Where a query matched: half-open `[start, end)` ranges in the text, in order. */
export type MatchRanges = [number, number][]

export type FuzzyMatch = { score: number; ranges: MatchRanges }

const MATCH = 16
/** A run of matched characters scores more than the same characters scattered. */
const CONSECUTIVE = 8
/** A matched character in the file name (after the last `/`) is worth more than in its folders. */
const BASENAME = 3
/** Each skipped character between two matches costs this much. */
const GAP = 1
const EXACT_CASE = 1
/** The match ends where the file name's stem does: `RunMessageProcessor` over `RunMessageProcessorTest`. */
const STEM_END = 12

/** What starting a word at `index` is worth: the path's start, a segment, a separator, a hump. */
function boundaryBonus(text: string, index: number): number {
  if (index === 0) return 10
  const previous = text.charAt(index - 1)
  const current = text.charAt(index)
  if (previous === '/' || previous === '\\') return 10
  if (previous === '_' || previous === '-' || previous === '.' || previous === ' ') return 8
  const isUpper = current !== current.toLowerCase() && current === current.toUpperCase()
  const previousLower = previous !== previous.toUpperCase() || /\d/.test(previous)
  if (isUpper && previousLower) return 8
  if (/\d/.test(current) && !/\d/.test(previous)) return 5
  return 0
}

/** Whether every query character appears in `text` in order, ignoring case: the cheap filter. */
function isSubsequence(query: string, text: string): boolean {
  let at = 0
  for (const char of query) {
    at = text.indexOf(char, at)
    if (at === -1) return false
    at++
  }
  return true
}

const toRanges = (positions: number[]): MatchRanges => {
  const ranges: MatchRanges = []
  for (const position of positions) {
    const last = ranges.at(-1)
    if (last !== undefined && last[1] === position) last[1] = position + 1
    else ranges.push([position, position + 1])
  }
  return ranges
}

/** How well `query` matches a path, as JetBrains matches `RunMessProc` or `pipe/rmp`; null when it doesn't. */
export function fuzzyPathMatch(query: string, text: string): FuzzyMatch | null {
  const pattern = query.replace(/\s+/g, '')
  if (pattern === '') return null
  const lowerPattern = pattern.toLowerCase()
  const lowerText = text.toLowerCase()
  if (!isSubsequence(lowerPattern, lowerText)) return null

  const n = pattern.length
  const m = text.length
  const basenameStart = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\')) + 1
  const value = (index: number, queryIndex: number): number =>
    MATCH +
    boundaryBonus(text, index) +
    (index >= basenameStart ? BASENAME : 0) +
    (text.charAt(index) === pattern.charAt(queryIndex) ? EXACT_CASE : 0)

  // best[i][j]: the best score with query character i matched at text position j; from[i][j]: where i-1 was.
  const NONE = Number.NEGATIVE_INFINITY
  const best: Float64Array[] = []
  const from: Int32Array[] = []
  for (let i = 0; i < n; i++) {
    const row = new Float64Array(m).fill(NONE)
    const back = new Int32Array(m).fill(-1)
    const char = lowerPattern.charAt(i)
    const previous = best[i - 1]
    // The best earlier match of i-1 at k < j-1, less the gap between it and j.
    let gapBest = NONE
    let gapFrom = -1
    for (let j = 0; j < m; j++) {
      if (previous !== undefined && j >= 2) {
        const candidate = previous[j - 2] ?? NONE
        if (candidate - GAP > gapBest - GAP) {
          gapBest = candidate - GAP
          gapFrom = j - 2
        } else gapBest -= GAP
      }
      if (lowerText.charAt(j) !== char) continue
      const own = value(j, i)
      if (previous === undefined) {
        row[j] = own
        continue
      }
      const adjacent = j >= 1 ? (previous[j - 1] ?? NONE) : NONE
      const viaAdjacent = adjacent + own + CONSECUTIVE
      const viaGap = gapBest + own
      if (viaAdjacent === NONE && viaGap === NONE) continue
      if (viaAdjacent >= viaGap) {
        row[j] = viaAdjacent
        back[j] = j - 1
      } else {
        row[j] = viaGap
        back[j] = gapFrom
      }
    }
    best.push(row)
    from.push(back)
  }

  const last = best[n - 1]
  if (last === undefined) return null
  let end = -1
  let score = NONE
  const stemEnd = text.indexOf('.', basenameStart + 1)
  for (let j = 0; j < m; j++) {
    const endsStem = j + 1 === (stemEnd === -1 ? m : stemEnd) && j >= basenameStart
    const each = (last[j] ?? NONE) + (endsStem ? STEM_END : 0)
    if (each > score) {
      score = each
      end = j
    }
  }
  if (end === -1) return null
  const positions: number[] = []
  for (let i = n - 1, j = end; i >= 0 && j >= 0; i--) {
    positions.push(j)
    j = from[i]?.[j] ?? -1
  }
  positions.reverse()
  return { score, ranges: toRanges(positions) }
}

const nameLength = (text: string): number =>
  text.length - Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\')) - 1

/** Higher score first, then the shorter file name, the shorter path, alphabetically: the listing order. */
export function compareMatches(
  a: { score: number; text: string },
  b: { score: number; text: string }
): number {
  return (
    b.score - a.score ||
    nameLength(a.text) - nameLength(b.text) ||
    a.text.length - b.text.length ||
    a.text.localeCompare(b.text)
  )
}
