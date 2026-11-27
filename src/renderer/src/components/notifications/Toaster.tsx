import { useEffect, useId, useRef, useState } from 'react'
import { type AppNotification, useNotificationStore } from '@/state/notification-store'
import { TextContextMenu } from '@/components/text-menu/TextContextMenu'
import { NotificationContent } from './NotificationContent'
import { notificationMenuItems } from './notification-menu-items'

/** Long enough to read a two-line message, as JetBrains balloons stay about this long. */
const AUTO_CLOSE_MS = 12_000

function Toast({ notification }: { notification: AppNotification }): React.JSX.Element {
  const closeToast = useNotificationStore((state) => state.closeToast)
  const titleId = useId()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  // Its menu takes the pointer and focus, yet the toast mustn't close under it.
  const [menuOpen, setMenuOpen] = useState(false)
  const remaining = useRef(AUTO_CLOSE_MS)
  const paused = hovered || focused || menuOpen
  const { id } = notification

  useEffect(() => {
    if (paused) return undefined
    const started = Date.now()
    const timer = setTimeout(() => closeToast(id), remaining.current)
    return () => {
      clearTimeout(timer)
      remaining.current -= Date.now() - started
    }
  }, [paused, id, closeToast])

  return (
    <TextContextMenu
      onOpenChange={setMenuOpen}
      renderItems={(element, choose) =>
        notificationMenuItems({
          notification,
          element,
          choose,
          close: { label: 'Close', run: () => closeToast(id) }
        })
      }
    >
      <div
        role="alert"
        data-text-scope
        aria-labelledby={titleId}
        data-severity={notification.severity}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
        }}
        className="pointer-events-auto w-toast rounded-popup border border-toast-border bg-toast p-3 text-toast-foreground shadow-lg"
      >
        <NotificationContent
          notification={notification}
          titleId={titleId}
          closeLabel="Close"
          onClose={() => closeToast(id)}
          showTime={false}
          scrollBody
        />
      </div>
    </TextContextMenu>
  )
}

/**
 * Toasts in the bottom-right corner of the main area, over the layout so nothing moves. Newest
 * first in the DOM, reversed on screen: should large ones outgrow the window, the stack scrolls
 * from the newest instead of running off its top.
 */
export function Toaster(): React.JSX.Element {
  const toasts = useNotificationStore((state) => state.toasts)
  const notifications = useNotificationStore((state) => state.notifications)
  const shown = toasts
    .toReversed()
    .flatMap((id) => notifications.filter((notification) => notification.id === id))
  return (
    <section
      aria-label="Notification toasts"
      className="pointer-events-none fixed top-island-gap right-tool-stripe bottom-status-bar z-50 flex flex-col-reverse gap-2 overflow-y-auto p-island-gap [scrollbar-width:none]"
    >
      {shown.map((notification) => (
        <Toast key={notification.id} notification={notification} />
      ))}
    </section>
  )
}
