import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { projectHeader } from './librarian-client'

describe('projectHeader', () => {
  it("sends a non-ASCII project path as its UTF-8 bytes, which fetch can't take as text", () => {
    const header = projectHeader('/tmp/проєкт')
    expect(() => new Headers({ 'X-Librarian-Project': header })).not.toThrow()
    expect(Buffer.from(header, 'latin1').toString('utf8')).toBe('/tmp/проєкт')
  })
})
