/** A `path:line` or `path:start-end` a chat reply refers to. */
export type CodeReference = { path: string; line: number; endLine: number | null }

const REFERENCE = /^(?<path>[^\s:`'"<>|]+):(?<line>[1-9]\d*)(?:-(?<end>[1-9]\d*))?$/

/** The reference a reply's inline code or link holds; null for anything else (`a:b`, `12:30`). */
export function parseCodeReference(text: string): CodeReference | null {
  const match = REFERENCE.exec(text.trim())
  const path = match?.groups?.['path']
  const line = Number(match?.groups?.['line'])
  if (path === undefined || !/[./]/.test(path) || /^\w+:\/\//.test(path)) return null
  const end = match?.groups?.['end']
  const endLine = end === undefined ? null : Number(end)
  return { path, line, endLine: endLine !== null && endLine > line ? endLine : null }
}

/** What `@file` and `@selection` stand for when the prompt is sent: the editor's shown file. */
export type PromptContext = {
  file: string | null
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
  if (!selectionUsed || context.file === null || context.selection === null)
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
