/** Where a link in a Markdown preview leads; `null` for a link that goes nowhere. */
export type MarkdownLinkTarget =
  | { kind: 'web'; url: string }
  | { kind: 'heading'; slug: string }
  | { kind: 'file'; path: string; slug: string | null }

const decoded = (text: string): string | null => {
  try {
    return decodeURIComponent(text)
  } catch {
    return null
  }
}

/** Joins `parts` onto `base`'s folders, as `..` and `.` say, never climbing above its root. */
function resolved(base: string, parts: string[]): string {
  const separator = base.includes('\\') ? '\\' : '/'
  const start = /^[\\/]*/.exec(base)?.[0] ?? ''
  const folders = base.split(/[\\/]/).filter(Boolean)
  // A Windows drive (`C:`) is the root itself.
  const floor = /^[A-Za-z]:$/.test(folders[0] ?? '') ? 1 : 0
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (folders.length > floor) folders.pop()
    } else folders.push(part)
  }
  return start.replaceAll('/', separator) + folders.join(separator)
}

/**
 * A link's target in the preview of the file at `from`: web links, `#heading` in the same file, and
 * paths to other files, relative to its folder or, starting with `/`, to the workspace folder it is
 * in (`root`, null outside one). Other schemes (`file:`, `javascript:`, ...) lead nowhere.
 */
export function markdownLinkTarget(
  href: string,
  from: string,
  root: string | null
): MarkdownLinkTarget | null {
  if (/^https?:\/\//i.test(href)) return { kind: 'web', url: href }
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return null
  const hash = href.indexOf('#')
  const link = hash === -1 ? href : href.slice(0, hash)
  const slug = hash === -1 ? null : decoded(href.slice(hash + 1))
  if (link === '') return slug ? { kind: 'heading', slug } : null
  const file = decoded(link.replace(/\?.*$/, ''))
  if (file === null || file === '') return null
  const fromRoot = file.startsWith('/')
  if (fromRoot && root === null) return null
  const base = fromRoot && root !== null ? root : resolved(from, ['..'])
  return { kind: 'file', path: resolved(base, file.split('/')), slug: slug || null }
}

/**
 * GitHub's anchor for a heading: lower case, punctuation dropped, spaces as dashes; a repeat of an
 * earlier heading's anchor gets `-1`, `-2`, ... (`seen` counts them across one document).
 */
export function headingSlug(text: string, seen: Map<string, number>): string {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .replace(/\s/g, '-')
  const count = seen.get(slug) ?? 0
  seen.set(slug, count + 1)
  return count === 0 ? slug : `${slug}-${count}`
}
