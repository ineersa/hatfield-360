import { describe, expect, it } from 'vitest'
import { isTrustedSenderUrl } from './trusted-sender'

describe('isTrustedSenderUrl', () => {
  it('accepts any route on the dev server origin', () => {
    expect(isTrustedSenderUrl('http://localhost:5173/settings', 'http://localhost:5173/')).toBe(
      true
    )
  })

  it('rejects another origin', () => {
    expect(isTrustedSenderUrl('http://localhost:5174/', 'http://localhost:5173/')).toBe(false)
    expect(isTrustedSenderUrl('https://example.com/', 'http://localhost:5173/')).toBe(false)
  })

  it('accepts only the bundled index file', () => {
    const entry = 'file:///app/out/renderer/index.html'
    expect(isTrustedSenderUrl('file:///app/out/renderer/index.html#/home', entry)).toBe(true)
    expect(isTrustedSenderUrl('file:///tmp/evil.html', entry)).toBe(false)
  })

  it('rejects unparsable sender URLs', () => {
    expect(isTrustedSenderUrl('', 'http://localhost:5173/')).toBe(false)
  })
})
