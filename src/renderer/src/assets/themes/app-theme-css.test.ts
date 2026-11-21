import { describe, expect, it } from 'vitest'
import { APP_THEMES } from '../../../../shared/themes/app-theme-catalog'

const raw = (files: Record<string, string>): Map<string, string> =>
  new Map(Object.entries(files).map(([path, css]) => [path.split('/').at(-1) ?? path, css]))

const THEMES = raw(
  import.meta.glob<string>('./app/*.css', { query: '?raw', import: 'default', eager: true })
)
const SHARED = raw(
  import.meta.glob<string>(['../main.css', '../terminal.css', './base.css'], {
    query: '?raw',
    import: 'default',
    eager: true
  })
)

/** Custom properties a stylesheet declares (`--name: value`). */
const declared = (css: string): string[] =>
  [...css.matchAll(/(--[\w-]+)\s*:/g)].map(([, name]) => name ?? '')

/** Custom properties a stylesheet reads with no fallback (`var(--name)`, not `var(--name, 4px)`). */
const read = (css: string): string[] =>
  [...css.matchAll(/var\((--[\w-]+)\)/g)].map(([, name]) => name ?? '')

describe('app theme stylesheets', () => {
  it('exist for every app theme in the catalog', () => {
    expect([...THEMES.keys()].toSorted()).toEqual(APP_THEMES.map(({ id }) => `${id}.css`))
  })

  it('each set every role the shared stylesheets read', () => {
    const shared = [...SHARED.values()]
    // The renderer sets this one from the terminal theme.
    const provided = new Set([...shared.flatMap(declared), '--terminal-background'])
    const needed = [...new Set(shared.flatMap(read))].filter((name) => !provided.has(name))
    expect(needed.length).toBeGreaterThan(50)
    const missing = [...THEMES].map(([file, css]) => {
      const roles = new Set(declared(css))
      return { file, roles: needed.filter((name) => !roles.has(name)) }
    })
    expect(missing).toEqual([...THEMES.keys()].map((file) => ({ file, roles: [] })))
  })

  it('are the only place colours are written', () => {
    expect(SHARED.size).toBe(3)
    for (const css of SHARED.values()) {
      expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|oklch)\(/i)
    }
  })
})
