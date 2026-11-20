import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { convertThemes } from './theme-conversion.mts'
import { openThemeSource } from './theme-source.mts'

const SOURCES = resolve(import.meta.dirname, 'sources')
const vendored = () => readdirSync(SOURCES).map((name) => openThemeSource(join(SOURCES, name)))
const themes = convertThemes(vendored())

const app = (id: string) => themes.app.find((theme) => theme.id === id)
const editor = (id: string) => themes.editor.find((theme) => theme.id === id)
const terminal = (id: string) => themes.terminal.find((theme) => theme.id === id)

describe('converting the vendored JetBrains themes', () => {
  it('offers the Islands and Catppuccin themes, not the classic ones they extend', () => {
    expect(themes.app.map(({ id }) => id)).toEqual([
      'high-contrast',
      'islands-catppuccin-frappe',
      'islands-catppuccin-latte',
      'islands-catppuccin-macchiato',
      'islands-catppuccin-mocha',
      'islands-darcula',
      'islands-dark',
      'islands-light'
    ])
  })

  it('reads Islands Dark roles through its parent themes and wildcard keys', () => {
    const roles = app('islands-dark')?.roles
    expect(roles?.get('frame')).toBe('#26282c')
    expect(roles?.get('island')).toBe('#191a1c')
    expect(roles?.get('tooltip')).toBe('#33353b')
    // Island.arc 20 is the IDE's diameter; CSS takes the radius.
    expect(roles?.get('island-radius')).toBe('10px')
  })

  it('resolves named palette colours of a plugin theme', () => {
    // ToolWindow.background is "panelBackground", itself the palette's "mantle".
    const roles = app('islands-catppuccin-mocha')?.roles
    expect(roles?.get('island')).toBe('#181825')
    expect(roles?.get('foreground')).toBe('#cdd6f4')
  })

  it('applies a scheme over its parent scheme', () => {
    const scheme = editor('islands-dark')?.scheme
    expect(scheme?.dark).toBe(true)
    expect(scheme?.colors.CONSOLE_BACKGROUND_KEY).toBe('#191a1c')
    // Islands Dark sets no keyword style of its own; Darcula, its parent, does.
    expect(scheme?.attributes.DEFAULT_KEYWORD?.foreground).toBe('#cf8e6d')
  })

  it('keeps the italics of Catppuccin and drops them in its no-italics variant', () => {
    expect(editor('catppuccin-mocha')?.scheme.attributes.DEFAULT_LINE_COMMENT?.italic).toBe(true)
    expect(
      editor('catppuccin-mocha-no-italics')?.scheme.attributes.DEFAULT_LINE_COMMENT?.italic
    ).toBeUndefined()
  })

  it('takes the terminal palette from the scheme console colours', () => {
    expect(terminal('islands-dark')?.palette).toMatchObject({
      background: '#191a1c',
      foreground: '#bcbec4'
    })
    expect(terminal('catppuccin-mocha')?.palette.red).toBe('#f38ba8')
  })

  it('imports a scheme file the IDE exported, over the scheme it was copied from', () => {
    // An IDE copy names its original's parent in parent_scheme but stores only its changes.
    const folder = mkdtempSync(join(tmpdir(), 'hatfield-scheme-'))
    const file = join(folder, '_@user_Catppuccin Mocha.icls')
    writeFileSync(
      file,
      `<scheme name="_@user_Catppuccin Mocha" version="142" parent_scheme="Darcula">
        <attributes>
          <option name="DEFAULT_KEYWORD">
            <value><option name="FOREGROUND" value="ff8800" /><option name="FONT_TYPE" value="1" /></value>
          </option>
        </attributes>
      </scheme>`
    )
    try {
      const imported = convertThemes([...vendored(), openThemeSource(file)])
      const copy = imported.editor.find(({ id }) => id === 'catppuccin-mocha-customised')
      expect(copy?.scheme.name).toBe('Catppuccin Mocha (customised)')
      expect(copy?.scheme.attributes.DEFAULT_KEYWORD).toEqual({ foreground: '#ff8800', bold: true })
      expect(copy?.scheme.attributes.DEFAULT_STRING?.foreground).toBe(
        editor('catppuccin-mocha')?.scheme.attributes.DEFAULT_STRING?.foreground
      )
    } finally {
      rmSync(folder, { recursive: true })
    }
  })
})
