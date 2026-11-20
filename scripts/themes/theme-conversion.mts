import type { EditorScheme } from '../../src/shared/themes/editor-scheme.ts'
import type { TerminalPalette } from '../../src/shared/themes/terminal-palette.ts'
import { APP_THEME_ROLES, cssValue } from './app-theme-roles.mts'
import { type SchemeFile, resolveScheme, schemeFiles } from './jetbrains-scheme.mts'
import {
  type UiTheme,
  type UiThemeFile,
  isOfferedUiTheme,
  resolveUiTheme,
  uiThemeFiles
} from './jetbrains-ui-theme.mts'
import { terminalPalette } from './terminal-palette.mts'
import type { ThemeSource } from './theme-source.mts'

type AppTheme = {
  id: string
  label: string
  dark: boolean
  /** Source files, root parent first, as `origin: path`. */
  origins: string[]
  /** Role name to CSS value, in table order. */
  roles: Map<string, string>
  /** Keys the theme sets that no role reads. */
  unmapped: string[]
}

type EditorTheme = { id: string; origin: string; scheme: EditorScheme }

type TerminalTheme = { id: string; label: string; palette: TerminalPalette }

export type ConvertedThemes = {
  app: AppTheme[]
  editor: EditorTheme[]
  terminal: TerminalTheme[]
}

/** `Islands Catppuccin Frappé` → `islands-catppuccin-frappe`. */
function themeId(name: string): string {
  return name
    .normalize('NFD')
    .replaceAll(/\p{M}/gu, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '')
}

function appRoles(theme: UiTheme): Map<string, string> {
  const values = new Map<string, string>()
  const value = (role: string, seen: string[]): string => {
    const known = values.get(role)
    if (known !== undefined) return known
    const spec = APP_THEME_ROLES[role]
    if (!spec) throw new Error(`Unknown fallback role ${role}`)
    for (const key of spec.keys) {
      const raw = theme.value(key)
      const css = raw === undefined ? undefined : cssValue(spec, raw)
      if (css !== undefined) {
        values.set(role, css)
        return css
      }
    }
    if (spec.fallback === undefined || seen.includes(spec.fallback)) {
      throw new Error(`${theme.file.name}: none of ${spec.keys.join(', ')} for role ${role}`)
    }
    const fallback = value(spec.fallback, [...seen, role])
    values.set(role, fallback)
    return fallback
  }
  return new Map(Object.keys(APP_THEME_ROLES).map((role) => [role, value(role, [])]))
}

const MAPPED_KEYS = new Set(Object.values(APP_THEME_ROLES).flatMap((role) => role.keys))

function appTheme(file: UiThemeFile, all: UiThemeFile[]): AppTheme {
  const theme = resolveUiTheme(file, all)
  return {
    id: themeId(file.name),
    label: file.name,
    dark: file.dark,
    origins: theme.chain.map((link) => `${link.source.origin}: ${link.path}`),
    roles: appRoles(theme),
    unmapped: theme.keys().filter((key) => !MAPPED_KEYS.has(key))
  }
}

/** The scheme a UI theme names in `editorScheme`: a path in its own source, or a scheme name. */
function editorSchemeOf(file: UiThemeFile, schemes: SchemeFile[]): SchemeFile {
  const reference = file.editorScheme
  const found = reference?.startsWith('/')
    ? schemes.find((scheme) => scheme.source === file.source && `/${scheme.path}` === reference)
    : schemes.find((scheme) => scheme.name === reference)
  if (!found) throw new Error(`${file.name}: editor scheme "${reference}" not found`)
  return found
}

function uniqueIds<T extends { id: string }>(themes: T[], kind: string): T[] {
  const seen = new Set<string>()
  for (const { id } of themes) {
    if (seen.has(id)) throw new Error(`Two ${kind} themes are named ${id}`)
    seen.add(id)
  }
  return themes
}

/**
 * Every offered theme in the sources: each UI theme (Islands and plugin themes; the IDE's classic and
 * `new` themes only serve as parents) becomes an app theme. Its editor scheme, and every scheme file
 * that isn't one of the IDE's base schemes, becomes an editor and a terminal theme.
 */
export function convertThemes(sources: ThemeSource[]): ConvertedThemes {
  const uiFiles = sources.flatMap(uiThemeFiles)
  const schemes = sources.flatMap(schemeFiles)
  const offered = uiFiles.filter(isOfferedUiTheme)
  const offeredSchemes = new Set([
    ...offered
      .filter((file) => file.editorScheme !== undefined)
      .map((file) => editorSchemeOf(file, schemes)),
    ...schemes.filter((scheme) => !scheme.isDefault)
  ])
  const editor = [...offeredSchemes]
    .map((file) => ({
      id: themeId(file.name),
      origin: `${file.source.origin}: ${file.path}`,
      scheme: resolveScheme(file, schemes)
    }))
    .toSorted((a, b) => a.scheme.name.localeCompare(b.scheme.name))
  return {
    app: uniqueIds(
      offered
        .map((file) => appTheme(file, uiFiles))
        .toSorted((a, b) => a.label.localeCompare(b.label)),
      'app'
    ),
    editor: uniqueIds(editor, 'editor'),
    terminal: editor.map(({ id, scheme }) => ({
      id,
      label: scheme.name,
      palette: terminalPalette(scheme)
    }))
  }
}
