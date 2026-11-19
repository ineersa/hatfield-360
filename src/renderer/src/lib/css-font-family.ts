const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'math',
  'emoji',
  'fangsong'
])

/**
 * A font setting as a CSS `font-family` value. A single font name is quoted, so names CSS can't take
 * bare ("Iosevka 2", "Font-Name!") still work; a stack the user wrote is used as written.
 */
export function cssFontFamily(setting: string): string {
  if (/[,'"]/.test(setting) || GENERIC_FAMILIES.has(setting.toLowerCase())) return setting
  return `"${setting}"`
}
