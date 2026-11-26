import { describe, expect, it } from 'vitest'
import { intelephenseExclude } from './intelephense-exclude'

describe('intelephenseExclude', () => {
  it("adds the project's git-ignored folders to Intelephense's defaults, but not dependencies", () => {
    const exclude = intelephenseExclude('/work/app', [
      '/work/app/var/tmp',
      '/work/app/var/cache',
      '/work/app/vendor',
      '/work/app/public/bundles/node_modules',
      '/work/app/packages/acme/vendor/bin',
      '/work/other/var'
    ])
    expect(exclude).toContain('**/vendor/**/{Tests,tests}/**')
    expect(exclude.filter((glob) => glob.startsWith('/'))).toEqual([
      '/work/app/var/tmp/**',
      '/work/app/var/cache/**'
    ])
  })

  it('escapes glob characters in folder names', () => {
    expect(intelephenseExclude('/work/[app]', ['/work/[app]/var/{tmp}'])).toContain(
      '/work/\\[app\\]/var/\\{tmp\\}/**'
    )
  })
})
