import { describe, expect, it } from 'vitest'
import { tabLabels } from './editor-tab-labels'

describe('editor tab labels', () => {
  it('are the file name alone while names differ', () => {
    const labels = tabLabels(['/work/app/src/index.ts', '/work/app/README.md'])
    expect(labels.get('/work/app/src/index.ts')).toEqual({ name: 'index.ts' })
    expect(labels.get('/work/app/README.md')).toEqual({ name: 'README.md' })
  })

  it('add the parent folder to files that share a name', () => {
    const labels = tabLabels(['/work/app/src/index.ts', '/work/app/test/index.ts'])
    expect(labels.get('/work/app/src/index.ts')).toEqual({ name: 'index.ts', folder: 'src' })
    expect(labels.get('/work/app/test/index.ts')).toEqual({ name: 'index.ts', folder: 'test' })
  })

  it('add as many folders as it takes to tell the files apart', () => {
    const labels = tabLabels([
      '/work/api/src/index.ts',
      '/work/web/src/index.ts',
      '/work/web/test/index.ts'
    ])
    expect(labels.get('/work/api/src/index.ts')?.folder).toBe('api/src')
    expect(labels.get('/work/web/src/index.ts')?.folder).toBe('web/src')
    expect(labels.get('/work/web/test/index.ts')?.folder).toBe('web/test')
  })

  it('keep Windows separators', () => {
    const labels = tabLabels(['C:\\work\\api\\src\\index.ts', 'C:\\work\\web\\src\\index.ts'])
    expect(labels.get('C:\\work\\api\\src\\index.ts')?.folder).toBe('api\\src')
  })
})
