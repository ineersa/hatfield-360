import { useId } from 'react'
import { type AppNotification, useNotificationStore } from '@/state/notification-store'
import { NotificationContent } from './NotificationContent'

function NotificationItem({ notification }: { notification: AppNotification }): React.JSX.Element {
  const dismiss = useNotificationStore((state) => state.dismiss)
  const titleId = useId()
  return (
    <li aria-labelledby={titleId} className="border-b border-separator px-4 py-3 last:border-b-0">
      <NotificationContent
        notification={notification}
        titleId={titleId}
        closeLabel="Dismiss"
        onClose={() => dismiss(notification.id)}
        showTime
      />
    </li>
  )
}

/** The session's notifications, newest first; opened from the bell. */
export function NotificationsPanel(): React.JSX.Element {
  const notifications = useNotificationStore((state) => state.notifications)
  const clearAll = useNotificationStore((state) => state.clearAll)
  return (
    <aside
      aria-label="Notifications panel"
      className="ml-island-gap flex w-notifications-panel shrink-0 flex-col overflow-hidden rounded-island bg-island"
    >
      <div className="flex h-panel-header shrink-0 items-center gap-2 pr-2 pl-4">
        <h2 className="type-panel-title flex-1">Notifications</h2>
        {notifications.length > 0 ? (
          <button
            type="button"
            onClick={clearAll}
            className="type-button rounded-button px-2 py-1 text-link hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            Clear all
          </button>
        ) : null}
      </div>
      {notifications.length > 0 ? (
        <ul aria-label="Notifications" className="min-h-0 flex-1 overflow-y-auto">
          {notifications.map((notification) => (
            <NotificationItem key={notification.id} notification={notification} />
          ))}
        </ul>
      ) : (
        <p className="type-description px-4">No notifications.</p>
      )}
    </aside>
  )
}
