import { describe, expect, it } from 'vitest'
import { ignoreRules } from '../git/ignore-rules'
import { intelephenseExclude } from './intelephense-exclude'

describe('intelephenseExclude', () => {
  it("adds git's ignore rules to Intelephense's defaults, but not dependency folders", () => {
    const exclude = intelephenseExclude('/work/app', [
      ...ignoreRules('/work/app', '/var/\n/vendor/\nnode_modules\n/tools/phar/vendor/\n'),
      ...ignoreRules('/work/app/vendor/acme/lib', 'build/\n')
    ])
    expect(exclude).toContain('**/vendor/**/{Tests,tests}/**')
    expect(exclude.filter((glob) => glob.startsWith('/'))).toEqual(['/work/app/var/**'])
  })
})
