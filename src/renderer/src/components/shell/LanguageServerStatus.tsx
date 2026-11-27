import { useEditorTabStore } from '@/state/editor-tab-store'
import { useLanguageServerStore } from '@/state/language-server-store'
import { useNotificationStore } from '@/state/notification-store'

const STATE_LABELS = {
  starting: 'starting…',
  ready: 'ready',
  restarting: 'restarting…',
  failed: 'stopped'
} as const

/** The active editor tab's language server; a stopped one opens the notification with its log. */
export function LanguageServerStatus(): React.JSX.Element | null {
  const active = useEditorTabStore((state) => state.activePath)
  const status = useLanguageServerStore((state) =>
    active === null ? undefined : state.files[active]
  )
  const openPanel = useNotificationStore((state) => state.togglePanel)
  const panelOpen = useNotificationStore((state) => state.panelOpen)
  if (!status) return null
  const label =
    status.state === 'ready' && status.progress
      ? `${status.server} language server: ${status.progress}`
      : `${status.server} language server ${STATE_LABELS[status.state]}`
  if (status.state !== 'failed') {
    return (
      <span role="status" className="mr-auto truncate">
        {label}
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={() => {
        if (!panelOpen) openPanel()
      }}
      className="mr-auto truncate rounded-button px-1 text-error hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {label}: show log
    </button>
  )
}
