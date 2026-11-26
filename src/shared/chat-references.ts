/** A file a chat reply refers to, at a line (and column) when it gives one. */
export type CodeReference = {
  path: string
  line: number | null
  endLine: number | null
  column: number | null
}

const LINE = '[1-9]\\d*'
// Inline code or a link target is all reference: any file name, the line suffix found lazily.
const EXACT_PATH = '[^\\s:`\'"<>|]+?'
// In prose, brackets may sit inside a path (`app/[id]/page.tsx`, `app/(auth)/x.ts`) but not at
// its ends, and a full stop or comma after it is the sentence's.
const PROSE_PATH =
  '[^\\s:`\'"<>|()\\[\\]{},;#*!?](?:[^\\s:`\'"<>|{},;#*!?]*[^\\s:`\'"<>|()\\[\\]{},;#*!?.])?'
const SUFFIX =
  `(?::(?<line>${LINE})(?::(?<column>${LINE})|-(?<end>${LINE})|(?:, ?${LINE})+)?` +
  `|#L(?<anchor>${LINE})(?:-L(?<anchorEnd>${LINE}))?)?`
const REFERENCE = new RegExp(`^(?<path>${EXACT_PATH})${SUFFIX}$`)
// In prose a reference starts a word; a URL is matched first so its parts are never one.
const IN_TEXT = new RegExp(
  `[a-z][\\w+.-]*://\\S+|(?<![^\\s(\\[{"'])(?<path>${PROSE_PATH})${SUFFIX}(?![\\w/-])`,
  'gi'
)

const looksLikeFile = (path: string): boolean =>
  // A folder or an extension (`src/x`, `x.ts`), not a number or a scheme (`1.2`, `a:b`).
  (path.includes('/') || /\.[a-z][\w-]*$/i.test(path)) &&
  /[a-z]/i.test(path) &&
  !/^[a-z][\w+.-]*:/i.test(path)

const reference = (groups: Record<string, string | undefined>): CodeReference | null => {
  const path = groups['path']
  if (path === undefined || !looksLikeFile(path)) return null
  const first = groups['line'] ?? groups['anchor']
  const last = groups['end'] ?? groups['anchorEnd']
  const line = first === undefined ? null : Number(first)
  const endLine = line !== null && last !== undefined && Number(last) > line ? Number(last) : null
  const column = groups['column'] === undefined ? null : Number(groups['column'])
  return { path, line, endLine, column }
}

/**
 * The file a reply's inline code or link names: `path`, `path:12`, `path:12-20`, `path:12,40`
 * (the first line), `path:12:5` (line and column) or `path#L12-L20`; null for anything else.
 */
export function parseCodeReference(text: string): CodeReference | null {
  const groups = REFERENCE.exec(text.trim())?.groups
  return groups === undefined ? null : reference(groups)
}

/** Where a reply's prose names files, in the forms `parseCodeReference` reads; never inside a URL. */
export function findCodeReferences(
  text: string
): { start: number; end: number; reference: CodeReference }[] {
  const found: { start: number; end: number; reference: CodeReference }[] = []
  for (const match of text.matchAll(IN_TEXT)) {
    const parsed = match.groups === undefined ? null : reference(match.groups)
    if (parsed !== null)
      found.push({ start: match.index, end: match.index + match[0].length, reference: parsed })
  }
  return found
}

/** What `@file` and `@selection` stand for when the prompt is sent: the editor's shown file. */
export type PromptContext = {
  file: string | null
  /** The selected lines and text; a caret alone is its line, with no text. */
  selection: { start: number; end: number; text: string } | null
}

const TOKEN = /(^|[\s(])@(selection|selected|file)\b/g

const fenceFor = (text: string): string => {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((run) => run[0].length))
  return '`'.repeat(longest + 1)
}

/**
 * The prompt with `@file` as the shown file's path and `@selection` (or `@selected`) as its
 * reference, the selected text following the message; an error when the editor has nothing for one.
 */
export function expandPromptReferences(
  text: string,
  context: PromptContext
): { ok: true; text: string } | { ok: false; error: string } {
  let problem: string | null = null
  let selectionUsed = false
  const expanded = text.replace(TOKEN, (_whole, before: string, token: string) => {
    if (context.file === null) {
      problem = 'No file is open in the editor.'
      return `${before}@${token}`
    }
    if (token === 'file') return `${before}\`${context.file}\``
    if (context.selection === null) {
      problem = 'Nothing is selected in the editor.'
      return `${before}@${token}`
    }
    selectionUsed = true
    return `${before}${selectionReference(context.file, context.selection)}`
  })
  if (problem !== null) return { ok: false, error: problem }
  if (
    !selectionUsed ||
    context.file === null ||
    context.selection === null ||
    context.selection.text === ''
  )
    return { ok: true, text: expanded }
  const { text: selected } = context.selection
  const fence = fenceFor(selected)
  return {
    ok: true,
    text: `${expanded}\n\n${selectionReference(context.file, context.selection)}:\n${fence}\n${selected}\n${fence}`
  }
}

const selectionReference = (file: string, { start, end }: { start: number; end: number }): string =>
  `\`${file}:${start === end ? start : `${start}-${end}`}\``
