import { describe, expect, it } from 'vitest'
import { acceleratorKeyString, keyStringAccelerators } from './key-strings'

describe('keyStringAccelerators', () => {
  it('reads VS Code keys as accelerators, in any modifier order and case', () => {
    expect(keyStringAccelerators('ctrl+shift+d', 'linux')).toEqual(['Ctrl+Shift+D'])
    expect(keyStringAccelerators('Shift+Ctrl+D', 'linux')).toEqual(['Ctrl+Shift+D'])
    expect(keyStringAccelerators('alt+left', 'linux')).toEqual(['Alt+Left'])
    expect(keyStringAccelerators('ctrl+-', 'linux')).toEqual(['Ctrl+-'])
    expect(keyStringAccelerators('shift+f6', 'linux')).toEqual(['Shift+F6'])
  })

  it('reads cmd and meta as Command on macOS and Super elsewhere', () => {
    expect(keyStringAccelerators('shift+cmd+[', 'darwin')).toEqual(['Command+Shift+['])
    expect(keyStringAccelerators('meta+e', 'linux')).toEqual(['Super+E'])
  })

  it('reads two chords, and refuses keys it does not know', () => {
    expect(keyStringAccelerators('ctrl+k ctrl+c', 'linux')).toEqual(['Ctrl+K', 'Ctrl+C'])
    expect(keyStringAccelerators('ctrl+k ctrl+c ctrl+d', 'linux')).toBeNull()
    expect(keyStringAccelerators('hyper+d', 'linux')).toBeNull()
    expect(keyStringAccelerators('ctrl+numpad5', 'linux')).toBeNull()
    expect(keyStringAccelerators('', 'linux')).toBeNull()
  })
})

describe('acceleratorKeyString', () => {
  it('writes accelerators the way VS Code writes keys', () => {
    expect(acceleratorKeyString('Command+Shift+D', 'darwin')).toBe('shift+cmd+d')
    expect(acceleratorKeyString('Ctrl+Alt+Shift+C', 'linux')).toBe('ctrl+shift+alt+c')
    expect(acceleratorKeyString('Ctrl+-', 'linux')).toBe('ctrl+-')
    expect(acceleratorKeyString('Alt+PageDown', 'linux')).toBe('alt+pagedown')
  })
})
