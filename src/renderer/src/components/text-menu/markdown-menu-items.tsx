import { Copy, ExternalLink, Link } from 'lucide-react'
import type { ReactNode } from 'react'
import { ContextMenuItem } from '@/components/ui/context-menu'
import { copyText } from './TextContextMenu'

/** Marks a link drawn as a button (a chat reply's file reference) with the address it opens. */
export const LINK_ADDRESS_ATTRIBUTE = 'data-link-address'

/**
 * Open Link and Copy Link Address on a link, Copy Code on a code block, for rendered Markdown; null
 * elsewhere. Open Link clicks the link, so it opens as the view's own links do.
 */
export function markdownMenuItems(
  element: Element,
  choose: (action: () => void) => void
): ReactNode {
  const link = element.closest(`a[href], [${LINK_ADDRESS_ATTRIBUTE}]`)
  const address = link?.getAttribute(LINK_ADDRESS_ATTRIBUTE) ?? link?.getAttribute('href') ?? ''
  const code = element.closest('pre')
  if (!(link instanceof HTMLElement) && code === null) return null
  return (
    <>
      {link instanceof HTMLElement ? (
        <>
          <ContextMenuItem onSelect={() => choose(() => link.click())}>
            <ExternalLink aria-hidden />
            Open Link
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void copyText(address)}>
            <Link aria-hidden />
            Copy Link Address
          </ContextMenuItem>
        </>
      ) : null}
      {code ? (
        <ContextMenuItem onSelect={() => void copyText(code.textContent)}>
          <Copy aria-hidden />
          Copy Code
        </ContextMenuItem>
      ) : null}
    </>
  )
}
