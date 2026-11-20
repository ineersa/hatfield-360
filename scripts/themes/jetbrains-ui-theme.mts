import { descendants, parseXml } from './xml-element.mts'
import { readText, type ThemeSource } from './theme-source.mts'

type UiValue = string | number | boolean

/** A `*.theme.json` file as found in a source. */
export type UiThemeFile = {
  source: ThemeSource
  path: string
  name: string
  dark: boolean
  parentTheme: string | undefined
  editorScheme: string | undefined
  /** The `themeProvider` id a plugin registers it under, if any. */
  providerId: string | undefined
  /** `classic` and `new` themes only serve as parents of the Islands themes. */
  targetUi: string | undefined
  colors: Record<string, unknown>
  ui: Record<string, unknown>
}

/** A UI theme with its parent chain applied: every `ui` key, colour names resolved to `#rrggbb[aa]`. */
export type UiTheme = {
  file: UiThemeFile
  /** The theme files applied, root parent first. */
  chain: UiThemeFile[]
  /** The value of a key, falling back to a `*.suffix` wildcard like the IDE does. */
  value: (key: string) => UiValue | undefined
  /** Every key the chain sets, wildcards as `*.suffix`. */
  keys: () => string[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function flatten(ui: Record<string, unknown>, prefix = '', out = new Map<string, unknown>()) {
  for (const [key, value] of Object.entries(ui)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (isRecord(value)) flatten(value, path, out)
    else out.set(path, value)
  }
  return out
}

type Provider = { id: string; path: string; targetUi: string | undefined }

/** `<themeProvider>` registrations in every plugin.xml of a source. */
function providers(source: ThemeSource): Provider[] {
  return [...source.files.keys()]
    .filter((path) => path === 'plugin.xml' || path.endsWith('/plugin.xml'))
    .flatMap((path) => descendants(parseXml(readText(source, path)), 'themeProvider'))
    .flatMap(({ attributes: { id, path, targetUi } }) =>
      id && path ? [{ id, path: path.replace(/^\//, ''), targetUi }] : []
    )
}

export function uiThemeFiles(source: ThemeSource): UiThemeFile[] {
  const registered = providers(source)
  return [...source.files.keys()]
    .filter((path) => path.endsWith('.theme.json'))
    .map((path) => {
      const json: unknown = JSON.parse(readText(source, path))
      if (!isRecord(json) || typeof json.name !== 'string') {
        throw new Error(`${source.origin}: ${path} is not a JetBrains UI theme`)
      }
      const provider = registered.find((candidate) => candidate.path === path)
      return {
        source,
        path,
        name: json.name,
        dark: json.dark === true,
        parentTheme: typeof json.parentTheme === 'string' ? json.parentTheme : undefined,
        editorScheme: typeof json.editorScheme === 'string' ? json.editorScheme : undefined,
        providerId: provider?.id,
        targetUi: provider?.targetUi,
        colors: isRecord(json.colors) ? json.colors : {},
        ui: isRecord(json.ui) ? json.ui : {}
      }
    })
}

/** Themes offered to the user; `classic` and `new` IDE themes are only parents of the Islands ones. */
export const isOfferedUiTheme = (file: UiThemeFile): boolean =>
  file.targetUi !== 'classic' && file.targetUi !== 'new'

/** `#RGB`, `#RRGGBB` or `#RRGGBBAA` in lower case, or undefined for anything else. */
function hexColour(value: string): string | undefined {
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value) ? value.toLowerCase() : undefined
}

function resolveColour(name: string, palette: Map<string, unknown>): string | undefined {
  let value: unknown = name
  for (let depth = 0; depth < 32 && typeof value === 'string'; depth++) {
    const hex = hexColour(value)
    if (hex) return hex
    if (!palette.has(value)) return undefined
    value = palette.get(value)
  }
  return undefined
}

export function resolveUiTheme(file: UiThemeFile, all: UiThemeFile[]): UiTheme {
  const chain: UiThemeFile[] = []
  for (let current: UiThemeFile | undefined = file; current;) {
    if (chain.includes(current)) throw new Error(`${file.name}: parentTheme loops`)
    chain.unshift(current)
    const parent: string | undefined = current.parentTheme
    if (parent === undefined) break
    current = all.find((candidate) => candidate.providerId === parent || candidate.name === parent)
    if (!current) throw new Error(`${file.name}: parent theme "${parent}" not found`)
  }
  const values = new Map<string, UiValue>()
  const wildcards = new Map<string, UiValue>()
  const palette = new Map<string, unknown>()
  for (const theme of chain) {
    // A theme's colour names resolve against its own palette and its parents'.
    for (const [name, value] of Object.entries(theme.colors)) palette.set(name, value)
    const resolve = (value: unknown): UiValue | undefined => {
      if (typeof value === 'number' || typeof value === 'boolean') return value
      if (typeof value !== 'string') return undefined
      // A colour name the palette lacks (High Contrast uses icon palette names) keeps the parent's value, as in the IDE.
      return resolveColour(value, palette) ?? (/^-?\d+(\.\d+)?$/.test(value) ? value : undefined)
    }
    const entries = [...flatten(theme.ui)]
    // Like the IDE: a wildcard first overrides that property for every component, then specific keys apply.
    for (const [key, raw] of entries) {
      if (!key.startsWith('*.')) continue
      const value = resolve(raw)
      if (value === undefined) continue
      const suffix = key.slice(1)
      wildcards.set(suffix.slice(1), value)
      for (const existing of values.keys())
        if (existing.endsWith(suffix)) values.set(existing, value)
    }
    for (const [key, raw] of entries) {
      if (key.startsWith('*.')) continue
      const value = resolve(raw)
      if (value !== undefined) values.set(key, value)
    }
  }
  return {
    file,
    chain,
    value: (key) => {
      if (values.has(key)) return values.get(key)
      // `Tree.selectionBackground` falls back to `*.selectionBackground`.
      for (let dot = key.indexOf('.'); dot !== -1; dot = key.indexOf('.', dot + 1)) {
        const wildcard = wildcards.get(key.slice(dot + 1))
        if (wildcard !== undefined) return wildcard
      }
      return undefined
    },
    keys: () => [...values.keys(), ...[...wildcards.keys()].map((suffix) => `*.${suffix}`)]
  }
}
