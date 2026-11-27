import { Copy, ExternalLink, Link } from 'lucide-react'
import type { ReactNode } from 'react'
import { ContextMenuItem } from '@/components/ui/context-menu'
import { copyText } from './TextContextMenu'

/**
 * Open Link and Copy Link Address on a link, Copy Code on a code block, for rendered Markdown; null
 * elsewhere. Open Link clicks the link, so it opens as the view's own links do.
 */
export function markdownMenuItems(
  element: Element,
  choose: (action: () => void) => void
): ReactNode {
  const link = element.closest('a[href]')
  const code = element.closest('pre')
  if (!(link instanceof HTMLAnchorElement) && code === null) return null
  return (
    <>
      {link instanceof HTMLAnchorElement ? (
        <>
          <ContextMenuItem onSelect={() => choose(() => link.click())}>
            <ExternalLink aria-hidden />
            Open Link
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => copyText(link.getAttribute('href') ?? '')}>
            <Link aria-hidden />
            Copy Link Address
          </ContextMenuItem>
        </>
      ) : null}
      {code ? (
        <ContextMenuItem onSelect={() => copyText(code.textContent)}>
          <Copy aria-hidden />
          Copy Code
        </ContextMenuItem>
      ) : null}
    </>
  )
}
