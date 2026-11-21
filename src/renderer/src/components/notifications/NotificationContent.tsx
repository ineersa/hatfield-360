import { X } from 'lucide-react'
import type { AppNotification } from '@/state/notification-store'
import { SeverityIcon } from './SeverityIcon'

const DISMISS_BUTTON_CLASS =
  'flex size-small-icon-button shrink-0 items-center justify-center rounded-button text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

/** A notification's icon, title, time, body and action, as a toast and as a panel item show it. */
export function NotificationContent({
  notification,
  titleId,
  closeLabel,
  onClose,
  showTime
}: {
  notification: AppNotification
  titleId: string
  closeLabel: string
  onClose: () => void
  showTime: boolean
}): React.JSX.Element {
  const { severity, title, body, action, time } = notification
  return (
    <div className="flex items-start gap-2.5">
      <SeverityIcon severity={severity} className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <p id={titleId} className="type-section-title min-w-0 flex-1 truncate">
            {title}
          </p>
          {showTime ? (
            <time dateTime={new Date(time).toISOString()} className="type-hint shrink-0">
              {new Date(time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
            </time>
          ) : null}
        </div>
        {body ? <p className="break-words">{body}</p> : null}
        {action ? (
          <button
            type="button"
            onClick={action.run}
            className="self-start rounded-button text-link hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {action.label}
          </button>
        ) : null}
      </div>
      <button
        type="button"
        aria-label={closeLabel}
        onClick={onClose}
        className={DISMISS_BUTTON_CLASS}
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  )
}
