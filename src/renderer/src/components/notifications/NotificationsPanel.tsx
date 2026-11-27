import { useId, useRef } from 'react'
import {
  SIDE_PANEL_HANDLE_WIDTH,
  SidePanelResizeHandle
} from '@/components/shell/SidePanelResizeHandle'
import { type AppNotification, useNotificationStore } from '@/state/notification-store'
import { SIDE_PANEL_MIN_WIDTH, useShellLayoutStore } from '@/state/shell-layout-store'
import { TextContextMenu } from '@/components/text-menu/TextContextMenu'
import { NotificationContent } from './NotificationContent'
import { notificationMenuItems } from './notification-menu-items'

function NotificationItem({ notification }: { notification: AppNotification }): React.JSX.Element {
  const dismiss = useNotificationStore((state) => state.dismiss)
  const clearAll = useNotificationStore((state) => state.clearAll)
  const titleId = useId()
  return (
    <TextContextMenu
      renderItems={(element, choose) =>
        notificationMenuItems({
          notification,
          element,
          choose,
          close: { label: 'Dismiss', run: () => dismiss(notification.id) },
          closeAll: { label: 'Dismiss All', run: clearAll }
        })
      }
    >
      <li
        aria-labelledby={titleId}
        data-text-scope
        className="border-b border-separator px-4 py-3 last:border-b-0"
      >
        <NotificationContent
          notification={notification}
          titleId={titleId}
          closeLabel="Dismiss"
          onClose={() => dismiss(notification.id)}
          showTime
          scrollBody={false}
        />
      </li>
    </TextContextMenu>
  )
}

/** The session's notifications, newest first; opened from the bell and resized from its left edge. */
export function NotificationsPanel(): React.JSX.Element {
  const notifications = useNotificationStore((state) => state.notifications)
  const clearAll = useNotificationStore((state) => state.clearAll)
  const width = useShellLayoutStore((state) => state.notificationsWidth)
  const setWidth = useShellLayoutStore((state) => state.setNotificationsWidth)
  const aside = useRef<HTMLElement>(null)
  // Up to half the row, so the side panel and the main area keep the rest.
  const maxWidth = (): number =>
    Math.max(
      SIDE_PANEL_MIN_WIDTH,
      (aside.current?.parentElement?.clientWidth ?? 0) / 2 - SIDE_PANEL_HANDLE_WIDTH
    )
  return (
    <>
      <SidePanelResizeHandle
        label="Resize Notifications panel"
        width={width}
        renderedWidth={() => aside.current?.getBoundingClientRect().width ?? width}
        minWidth={SIDE_PANEL_MIN_WIDTH}
        maxWidth={maxWidth}
        onWidthChange={(next) => setWidth(Math.min(next, maxWidth()))}
        panelSide="right"
      />
      <aside
        ref={aside}
        aria-label="Notifications panel"
        // It shrinks below its minimum only when the window is too narrow for the side panel and main area too;
        // the chosen width returns when there is room.
        style={{ width, maxWidth: `calc(50% - ${SIDE_PANEL_HANDLE_WIDTH}px)` }}
        className="flex min-w-0 flex-col overflow-hidden rounded-island bg-island"
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
          <ul
            aria-label="Notifications"
            className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]"
          >
            {notifications.map((notification) => (
              <NotificationItem key={notification.id} notification={notification} />
            ))}
          </ul>
        ) : (
          <p className="type-description px-4">No notifications.</p>
        )}
      </aside>
    </>
  )
}
