import { describe, expect, it } from 'vitest'
import { cssFontFamily } from './css-font-family'

describe('cssFontFamily', () => {
  it('quotes a single font name, including ones CSS would reject bare', () => {
    expect(cssFontFamily('Noto Sans')).toBe('"Noto Sans"')
    expect(cssFontFamily('3270 Nerd Font')).toBe('"3270 Nerd Font"')
  })

  it('keeps stacks, quoted names and generic families as written', () => {
    expect(cssFontFamily("'Fira Code', monospace")).toBe("'Fira Code', monospace")
    expect(cssFontFamily('"Iosevka"')).toBe('"Iosevka"')
    expect(cssFontFamily('monospace')).toBe('monospace')
    expect(cssFontFamily('System-UI')).toBe('System-UI')
  })
})
