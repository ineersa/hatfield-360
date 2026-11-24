import { isTerminalShown, selectTerminal } from '@/components/terminal/terminal-tab-controllers'
import { AGENT_PROVIDERS, type AgentNotification } from '../../../shared/agent-api'
import { playAgentNotificationSound } from '@/lib/agent-notification-sound'
import { useSettingsStore } from './settings-store'
import { shouldShowAgentToast } from './agent-toast-policy'
import { notify, type NotificationSeverity } from './notification-store'

const stateNotices = {
  'needs-input': { title: 'Agent needs input', severity: 'warning' },
  completed: { title: 'Agent turn completed', severity: 'info' },
  failed: { title: 'Agent turn failed', severity: 'error' }
} satisfies Record<string, { title: string; severity: NotificationSeverity }>

function soundsEnabled(): boolean {
  const { loaded, values } = useSettingsStore.getState()
  return loaded && values['notifications.agentSounds']
}

export function receiveAgentNotification({
  provider,
  providerSessionId,
  terminalId,
  ownerWindowFocusedAndVisible,
  message
}: AgentNotification): void {
  const source = `${AGENT_PROVIDERS[provider]} · ${providerSessionId}`
  const explicit = message.kind === 'explicit'
  const content = explicit
    ? { title: message.title || 'Agent message', severity: 'info' as const }
    : stateNotices[message.kind]
  const showToast = shouldShowAgentToast(
    message.kind,
    ownerWindowFocusedAndVisible,
    isTerminalShown(terminalId)
  )
  notify(
    {
      ...content,
      body: explicit && message.body ? `${source}\n${message.body}` : source,
      action: {
        label: 'Open terminal',
        run: () => {
          if (!selectTerminal(terminalId)) {
            notify({ severity: 'warning', title: 'Terminal no longer available', body: source })
          }
        }
      }
    },
    {
      showToast
    }
  )
  if (!explicit && showToast && soundsEnabled()) {
    void playAgentNotificationSound(message.kind, soundsEnabled)
  }
}
