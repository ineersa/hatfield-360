/** The sections of the workspace map file that the app maintains; the rest is the user's text. */
export type MapSection = 'workspace' | 'playbook'

/** Characters each section may hold, so the file can't crowd the chat's context. */
export const SECTION_CAPS: Record<MapSection, number> = { workspace: 16_000, playbook: 8_000 }

/** The most of the file a chat's system prompt carries, sections and user text together. */
const INSTRUCTIONS_CAP = 32_000

const opening = (section: MapSection): string => `<!-- ${section} -->`
const closing = (section: MapSection): string => `<!-- /${section} -->`

type Located = { start: number; bodyStart: number; bodyEnd: number; end: number }

function locate(text: string, section: MapSection): Located | null {
  const start = text.indexOf(opening(section))
  if (start < 0) return null
  const bodyStart = start + opening(section).length
  const bodyEnd = text.indexOf(closing(section), bodyStart)
  if (bodyEnd < 0) return null
  return { start, bodyStart, bodyEnd, end: bodyEnd + closing(section).length }
}

const block = (section: MapSection, body: string): string =>
  `${opening(section)}\n${body.trim()}\n${closing(section)}`

/** The section's text, or null when the file has no such section. */
function sectionBody(text: string, section: MapSection): string | null {
  const found = locate(text, section)
  return found ? text.slice(found.bodyStart, found.bodyEnd).trim() : null
}

/** Any section marker, which written text must not carry: it would end its section early. */
const MARKER = /<!--\s*\/?\s*(?:workspace|playbook)\s*-->/gi

/** Replaces the section's body, keeping everything around it; a missing section is added at the end. */
export function replaceSection(text: string, section: MapSection, body: string): string {
  const capped = body.replace(MARKER, '').trim().slice(0, SECTION_CAPS[section])
  const found = locate(text, section)
  if (found) return `${text.slice(0, found.start)}${block(section, capped)}${text.slice(found.end)}`
  const before = text.trimEnd()
  return `${before ? `${before}\n\n` : ''}${block(section, capped)}\n`
}

export type PlaybookAppend = { status: 'saved'; text: string } | { status: 'full' }

/** Adds one entry to the playbook as a list item; refused when the playbook would pass its cap. */
export function appendToPlaybook(text: string, entry: string): PlaybookAppend {
  const item = `- ${entry.trim().replace(/\s*\n\s*/g, ' ')}`
  const current = sectionBody(text, 'playbook') ?? ''
  const next = current ? `${current}\n${item}` : item
  if (next.length > SECTION_CAPS.playbook) return { status: 'full' }
  return { status: 'saved', text: replaceSection(text, 'playbook', next) }
}

/**
 * The workspace block from the map turn's reply: what's between the markers when it wrote them,
 * else the whole reply.
 */
export function mapBlockFromReply(reply: string): string {
  return sectionBody(reply, 'workspace') ?? reply.trim()
}

/** The file as a chat's instructions, each section and the whole capped. */
export function instructionsForPrompt(text: string): string {
  let capped = text
  for (const section of ['workspace', 'playbook'] as const) {
    const body = sectionBody(capped, section)
    if (body !== null && body.length > SECTION_CAPS[section])
      capped = replaceSection(capped, section, body)
  }
  return capped.trim().slice(0, INSTRUCTIONS_CAP)
}
