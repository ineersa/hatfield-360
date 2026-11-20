import { describe, expect, it } from 'vitest'
import { webLinkUrl } from './terminal-request'

describe('webLinkUrl', () => {
  it('passes http and https links', () => {
    expect(webLinkUrl('https://example.com/a?b=c')).toBe('https://example.com/a?b=c')
    expect(webLinkUrl('http://localhost:5173')).toBe('http://localhost:5173/')
  })

  it('refuses links that could run something on the computer', () => {
    for (const url of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'vscode://file/x',
      'smb://host/share',
      'not a url'
    ]) {
      expect(webLinkUrl(url)).toBeNull()
    }
  })
})
