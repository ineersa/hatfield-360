import { useEffect, useId, useRef, useState } from 'react'
import { type AppNotification, useNotificationStore } from '@/state/notification-store'
import { NotificationContent } from './NotificationContent'

/** Long enough to read a two-line message, as JetBrains balloons stay about this long. */
const AUTO_CLOSE_MS = 12_000

function Toast({ notification }: { notification: AppNotification }): React.JSX.Element {
  const closeToast = useNotificationStore((state) => state.closeToast)
  const titleId = useId()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const remaining = useRef(AUTO_CLOSE_MS)
  const paused = hovered || focused
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
    <div
      role="alert"
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
      />
    </div>
  )
}

/** Toasts in the bottom-right corner of the main area, over the layout so nothing moves. */
export function Toaster(): React.JSX.Element {
  const toasts = useNotificationStore((state) => state.toasts)
  const notifications = useNotificationStore((state) => state.notifications)
  const shown = toasts.flatMap((id) =>
    notifications.filter((notification) => notification.id === id)
  )
  return (
    <section
      aria-label="Notification toasts"
      className="pointer-events-none fixed right-[calc(var(--tool-stripe-width)+var(--island-gap))] bottom-[calc(var(--status-bar-height)+var(--island-gap))] z-50 flex flex-col gap-2"
    >
      {shown.map((notification) => (
        <Toast key={notification.id} notification={notification} />
      ))}
    </section>
  )
}
