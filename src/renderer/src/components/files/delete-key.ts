import { rendererPlatform } from '@/lib/shortcut-keys'

/** The trees' delete-to-trash key, as menus show it. */
export const DELETE_LABEL = rendererPlatform === 'darwin' ? '⌘⌫' : 'Delete'

/** Delete alone, or ⌘⌫ on macOS: asks to move the focused entry to the trash. */
export function isDeleteKey(event: {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}): boolean {
  const plain = !event.ctrlKey && !event.metaKey && !event.altKey
  return (
    (event.key === 'Delete' && plain) ||
    (rendererPlatform === 'darwin' && event.metaKey && event.key === 'Backspace')
  )
}
