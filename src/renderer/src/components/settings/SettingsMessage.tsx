import { MessageBar } from '@/components/shell/MessageBar'
import { useSettingsStore } from '@/state/settings-store'

/** What is wrong with settings.json or a change to it; the app keeps running on the values it could use. */
export function SettingsMessage(): React.JSX.Element | null {
  const error = useSettingsStore((state) => state.error)
  const notice = useSettingsStore((state) =>
    state.notice && state.notice.id !== state.dismissedNoticeId ? state.notice.message : null
  )
  const dismiss = useSettingsStore((state) => state.dismissMessage)
  const message = error ?? notice
  if (!message) return null
  return <MessageBar label="Settings message" message={message} onDismiss={dismiss} />
}
