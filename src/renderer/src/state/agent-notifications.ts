import { isTerminalShown, selectTerminal } from '@/components/terminal/terminal-tab-controllers'
import { agentSessionIdentity } from '@/components/workspace/AgentSessionRows'
import { AGENT_PROVIDERS, type AgentNotification } from '../../../shared/agent-api'
import { AGENT_SOUND_KEYS } from '../../../shared/agent-sound-catalog'
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
  title,
  terminalId,
  ownerWindowFocusedAndVisible,
  message
}: AgentNotification): void {
  const { displayName } = agentSessionIdentity({ provider, providerSessionId, title })
  const source = `${AGENT_PROVIDERS[provider]} · ${displayName}`
  const explicit = message.kind === 'explicit'
  const content = explicit
    ? { title: message.title || 'Agent message', severity: 'info' as const }
    : stateNotices[message.kind]
  const detail = explicit ? message.body : null
  const response = message.kind === 'completed' ? message.response : null
  const showToast = shouldShowAgentToast(
    message.kind,
    ownerWindowFocusedAndVisible,
    isTerminalShown(terminalId)
  )
  notify(
    {
      ...content,
      body: detail ? `${source}\n${detail}` : source,
      ...(response ? { markdown: response } : {}),
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
    const sound = useSettingsStore.getState().values[AGENT_SOUND_KEYS[message.kind]]
    void playAgentNotificationSound(sound, soundsEnabled)
  }
}
