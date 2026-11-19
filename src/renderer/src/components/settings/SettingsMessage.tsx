import { MessageBar } from '@/components/shell/MessageBar'
import { useSettingsStore } from '@/state/settings-store'

/** What is wrong with settings.json; the app keeps running on the values it could use. */
export function SettingsMessage(): React.JSX.Element | null {
  const message = useSettingsStore((state) =>
    state.notice && state.notice.id !== state.dismissedNoticeId ? state.notice.message : null
  )
  const dismiss = useSettingsStore((state) => state.dismissNotice)
  if (!message) return null
  return <MessageBar label="Settings message" message={message} onDismiss={dismiss} />
}
