import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ASSETS = resolve(import.meta.dirname, '../../src/renderer/src/assets')
const APP_THEMES = join(ASSETS, 'themes/app')

/** Custom properties a stylesheet declares (`--name: value`). */
const declared = (css: string): Set<string> =>
  new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map(([, name]) => name ?? ''))

/** Custom properties a stylesheet reads with no fallback (`var(--name)`, not `var(--name, 4px)`). */
const read = (css: string): Set<string> =>
  new Set([...css.matchAll(/var\((--[\w-]+)\)/g)].map(([, name]) => name ?? ''))

describe('app theme stylesheets', () => {
  const themeFiles = readdirSync(APP_THEMES)
  const shared = ['main.css', 'terminal.css', 'themes/base.css'].map((path) =>
    readFileSync(join(ASSETS, path), 'utf8')
  )

  it('each set every role the shared stylesheets read', () => {
    const provided = new Set(shared.flatMap((css) => [...declared(css)]))
    // The renderer sets this one from the terminal theme.
    provided.add('--terminal-background')
    const needed = [...new Set(shared.flatMap((css) => [...read(css)]))].filter(
      (name) => !provided.has(name)
    )
    expect(needed.length).toBeGreaterThan(50)
    const missing = themeFiles.map((file) => {
      const roles = declared(readFileSync(join(APP_THEMES, file), 'utf8'))
      return { file, roles: needed.filter((name) => !roles.has(name)) }
    })
    expect(missing).toEqual(themeFiles.map((file) => ({ file, roles: [] })))
  })

  it('are the only place colours are written', () => {
    for (const css of shared) {
      expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|oklch)\(/i)
    }
  })
})
