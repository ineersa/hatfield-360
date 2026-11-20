import type {
  EditorScheme,
  TextAttributes,
  TextEffect
} from '../../src/shared/themes/editor-scheme.ts'
import { readText, type ThemeSource } from './theme-source.mts'
import { type XmlElement, descendants, parseXml } from './xml-element.mts'

/** One attribute key as a scheme file writes it: its own values, or "same as" another key. */
type RawAttribute = { attributes: TextAttributes } | { base: string }

/** A `<scheme>` from an `.icls`, a scheme `.xml` or the IDE's DefaultColorSchemesManager.xml. */
export type SchemeFile = {
  source: ThemeSource
  path: string
  /** As the user sees it: an IDE copy `_@user_X` is labelled `X (customised)`. */
  name: string
  /**
   * The scheme this one changes. For an IDE copy that is the scheme it was copied from (when the
   * sources have it), not its `parent_scheme`: the IDE saves only the copy's changes to the original.
   */
  parent: string | undefined
  /** `parent_scheme` as written, used when an IDE copy's original isn't in the sources. */
  parentScheme: string | undefined
  /** The IDE's built-in base schemes (Default, Darcula). */
  isDefault: boolean
  /** null: the scheme clears the colour its parent sets. */
  colors: Map<string, string | null>
  attributes: Map<string, RawAttribute>
}

/** The effect types JetBrains stores as numbers in `EFFECT_TYPE`. */
const EFFECTS: Record<string, TextEffect['type']> = {
  '0': 'box',
  '1': 'underline',
  '2': 'wave',
  '3': 'strikethrough',
  '4': 'bold-underline',
  '5': 'dotted-underline',
  '6': 'box'
}

/** The IDE's name prefix for an editable copy of a bundled scheme. */
const USER_COPY = '_@user_'

/** Scheme colours are hex without `#`, and without leading zeros (`ff` is #0000ff). */
function schemeColour(value: string | undefined): string | null {
  if (value === undefined || value === '') return null
  if (!/^[0-9a-f]{1,8}$/i.test(value)) return null
  const hex = value.length > 6 ? value.padStart(8, '0') : value.padStart(6, '0')
  return `#${hex.toLowerCase()}`
}

function options(element: XmlElement | undefined): XmlElement[] {
  return element?.children.filter((child) => child.name === 'option') ?? []
}

function textAttributes(value: XmlElement | undefined): TextAttributes {
  const fields = new Map(
    options(value).map((option) => [option.attributes.name, option.attributes.value])
  )
  const result: TextAttributes = {}
  const foreground = schemeColour(fields.get('FOREGROUND'))
  const background = schemeColour(fields.get('BACKGROUND'))
  const stripe = schemeColour(fields.get('ERROR_STRIPE_COLOR'))
  const effectColour = schemeColour(fields.get('EFFECT_COLOR'))
  const fontType = Number(fields.get('FONT_TYPE') ?? 0)
  if (foreground) result.foreground = foreground
  if (background) result.background = background
  if (fontType & 1) result.bold = true
  if (fontType & 2) result.italic = true
  if (effectColour) {
    result.effect = {
      type: EFFECTS[fields.get('EFFECT_TYPE') ?? '0'] ?? 'box',
      color: effectColour
    }
  }
  if (stripe) result.errorStripe = stripe
  return result
}

function schemeFile(source: ThemeSource, path: string, scheme: XmlElement): SchemeFile {
  const { name, parent_scheme: parent, default_scheme: isDefault } = scheme.attributes
  if (!name) throw new Error(`${source.origin}: ${path} has a scheme without a name`)
  const section = (title: string) => scheme.children.find((child) => child.name === title)
  const colors = new Map<string, string | null>()
  for (const { attributes } of options(section('colors'))) {
    if (attributes.name) colors.set(attributes.name, schemeColour(attributes.value))
  }
  const attributes = new Map<string, RawAttribute>()
  for (const option of options(section('attributes'))) {
    const key = option.attributes.name
    if (!key) continue
    const base = option.attributes.baseAttributes
    const value = option.children.find((child) => child.name === 'value')
    attributes.set(key, base && !value ? { base } : { attributes: textAttributes(value) })
  }
  const copyOf = name.startsWith(USER_COPY) ? name.slice(USER_COPY.length) : undefined
  return {
    source,
    path,
    name: copyOf === undefined ? name : `${copyOf} (customised)`,
    parent: copyOf ?? parent,
    parentScheme: parent,
    isDefault: isDefault === 'true',
    colors,
    attributes
  }
}

/** Every scheme in a source's `.icls` and `.xml` files. */
export function schemeFiles(source: ThemeSource): SchemeFile[] {
  return [...source.files.keys()]
    .filter((path) => /\.(icls|xml)$/i.test(path) && !path.endsWith('plugin.xml'))
    .flatMap((path) => {
      const root = parseXml(readText(source, path))
      const schemes = root.name === 'scheme' ? [root] : descendants(root, 'scheme')
      return schemes.map((scheme) => schemeFile(source, path, scheme))
    })
}

/** Text background luminance below this reads as a dark scheme. */
const DARK_LUMINANCE = 0.5

function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map(
    (at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255
  )
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** A scheme with its `parent_scheme` chain and `baseAttributes` references applied. */
export function resolveScheme(file: SchemeFile, all: SchemeFile[]): EditorScheme {
  const chain: SchemeFile[] = []
  for (let current: SchemeFile | undefined = file; current;) {
    if (chain.includes(current)) throw new Error(`${file.name}: parent_scheme loops`)
    chain.unshift(current)
    const wanted: string | undefined = current.parent
    const fallback: string | undefined = current.parentScheme
    const named = (name: string | undefined): SchemeFile | undefined =>
      all.find((candidate) => candidate.name === name && !chain.includes(candidate))
    const parent: SchemeFile | undefined = named(wanted) ?? named(fallback)
    if (wanted === undefined) break
    if (!parent) throw new Error(`${file.name}: parent scheme "${wanted}" not found`)
    current = parent
  }
  const colorValues = new Map<string, string | null>()
  const raw = new Map<string, RawAttribute>()
  for (const scheme of chain) {
    for (const [key, value] of scheme.colors) colorValues.set(key, value)
    for (const [key, value] of scheme.attributes) raw.set(key, value)
  }
  const resolved = new Map<string, TextAttributes>()
  const resolve = (key: string, seen: string[] = []): TextAttributes => {
    const known = resolved.get(key)
    if (known) return known
    const entry = raw.get(key)
    if (!entry || seen.includes(key)) return {}
    const value = 'base' in entry ? resolve(entry.base, [...seen, key]) : entry.attributes
    resolved.set(key, value)
    return value
  }
  const colors: Record<string, string> = {}
  for (const [key, value] of [...colorValues].toSorted(([a], [b]) => a.localeCompare(b))) {
    if (value) colors[key] = value
  }
  const attributes: Record<string, TextAttributes> = {}
  for (const key of [...raw.keys()].toSorted((a, b) => a.localeCompare(b))) {
    const value = resolve(key)
    if (Object.keys(value).length > 0) attributes[key] = value
  }
  const background = attributes.TEXT?.background ?? '#ffffff'
  return { name: file.name, dark: luminance(background) < DARK_LUMINANCE, colors, attributes }
}
