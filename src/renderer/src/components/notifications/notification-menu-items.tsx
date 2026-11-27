import { BellOff, Copy, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { markdownMenuItems } from '@/components/text-menu/markdown-menu-items'
import { copyText } from '@/components/text-menu/TextContextMenu'
import { ContextMenuItem, ContextMenuSeparator } from '@/components/ui/context-menu'
import type { AppNotification } from '@/state/notification-store'

/** A notification as text: its title, body and reply, as they read on screen. */
function notificationText({ title, body, markdown }: AppNotification): string {
  return [title, body, markdown].filter((part) => part !== undefined && part !== '').join('\n\n')
}

/** A notification's own items: the reply's link or code, Copy Notification, then closing ones. */
export function notificationMenuItems({
  notification,
  element,
  choose,
  close,
  closeAll
}: {
  notification: AppNotification
  element: Element
  choose: (action: () => void) => void
  close: { label: string; run: () => void }
  closeAll?: { label: string; run: () => void }
}): ReactNode {
  const markdown = markdownMenuItems(element, choose)
  return (
    <>
      {markdown ? (
        <>
          {markdown}
          <ContextMenuSeparator />
        </>
      ) : null}
      <ContextMenuItem onSelect={() => copyText(notificationText(notification))}>
        <Copy aria-hidden />
        Copy Notification
      </ContextMenuItem>
      <ContextMenuItem onSelect={close.run}>
        <X aria-hidden />
        {close.label}
      </ContextMenuItem>
      {closeAll ? (
        <ContextMenuItem onSelect={closeAll.run}>
          <BellOff aria-hidden />
          {closeAll.label}
        </ContextMenuItem>
      ) : null}
    </>
  )
}
