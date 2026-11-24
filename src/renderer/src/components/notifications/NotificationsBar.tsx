import { Bell } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/class-names'
import { useNotificationStore } from '@/state/notification-store'

/** The window's right edge, holding the bell that opens the notifications panel. */
export function NotificationsBar(): React.JSX.Element {
  const count = useNotificationStore((state) => state.notifications.length)
  const panelOpen = useNotificationStore((state) => state.panelOpen)
  const togglePanel = useNotificationStore((state) => state.togglePanel)
  return (
    <nav
      aria-label="Tool windows"
      className="flex w-tool-stripe shrink-0 flex-col items-center pt-0.5 pb-1.5"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={count > 0 ? `Notifications (${count})` : 'Notifications'}
            aria-pressed={panelOpen}
            onClick={togglePanel}
            className={cn(
              'relative flex size-activity-button items-center justify-center rounded-button text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              panelOpen &&
                'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground'
            )}
          >
            <Bell className="size-5.5" strokeWidth={1.75} aria-hidden />
            {count > 0 && !panelOpen ? (
              <span
                aria-hidden
                className="absolute top-1 right-1 size-2.5 rounded-full bg-primary ring-2 ring-frame"
              />
            ) : null}
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">
          <span className="type-tooltip-title">Notifications</span>
        </TooltipContent>
      </Tooltip>
    </nav>
  )
}
