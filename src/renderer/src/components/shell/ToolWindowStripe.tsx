import { Bell, MessagesSquare } from 'lucide-react'
import type { ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/class-names'
import { appShortcutLabel } from '@/lib/keymap-match'
import { useChatStore } from '@/state/chat-store'
import { useKeymapStore } from '@/state/keymap-store'
import { useNotificationStore } from '@/state/notification-store'

function StripeButton({
  label,
  title,
  shortcut,
  pressed,
  onClick,
  children
}: {
  /** The accessible name, which may add a count to the title. */
  label: string
  title: string
  shortcut: string
  pressed: boolean
  onClick: () => void
  children: ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={pressed}
          onClick={onClick}
          className={cn(
            'relative flex size-activity-button items-center justify-center rounded-button text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
            pressed &&
              'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground'
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="left">
        <span className="type-tooltip-title">{title}</span>
        {shortcut === '' ? null : (
          <span className="text-tooltip-muted-foreground"> {shortcut}</span>
        )}
      </TooltipContent>
    </Tooltip>
  )
}

/** The window's right edge: the notifications panel's bell, and the chat under it. */
export function ToolWindowStripe(): React.JSX.Element {
  const count = useNotificationStore((state) => state.notifications.length)
  const notificationsOpen = useNotificationStore((state) => state.panelOpen)
  const toggleNotifications = useNotificationStore((state) => state.togglePanel)
  const chatOpen = useChatStore((state) => state.open)
  const newChatShortcut = useKeymapStore((state) => appShortcutLabel(state.shell, 'new-chat'))
  return (
    <nav
      aria-label="Tool windows"
      className="flex w-tool-stripe shrink-0 flex-col items-center gap-1 pt-0.5 pb-1.5"
    >
      <StripeButton
        label={count > 0 ? `Notifications (${count})` : 'Notifications'}
        title="Notifications"
        shortcut=""
        pressed={notificationsOpen}
        onClick={toggleNotifications}
      >
        <Bell className="size-5.5" strokeWidth={1.75} aria-hidden />
        {count > 0 && !notificationsOpen ? (
          <span
            aria-hidden
            className="absolute top-1 right-1 size-2.5 rounded-full bg-primary ring-2 ring-frame"
          />
        ) : null}
      </StripeButton>
      <StripeButton
        label="Chat"
        title="Chat"
        shortcut={newChatShortcut}
        pressed={chatOpen}
        onClick={() => {
          // As its panel's Close Chat does, closing ends the chat.
          const chat = useChatStore.getState()
          if (chat.open) chat.close()
          else chat.openNewChat()
        }}
      >
        <MessagesSquare className="size-5.5" strokeWidth={1.75} aria-hidden />
      </StripeButton>
    </nav>
  )
}
