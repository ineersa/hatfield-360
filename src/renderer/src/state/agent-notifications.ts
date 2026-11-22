import { isTerminalShown, selectTerminal } from '@/components/terminal/terminal-tab-controllers'
import { AGENT_PROVIDERS, type AgentNotification } from '../../../shared/agent-api'
import { notify, type NotificationSeverity } from './notification-store'

const stateNotices = {
  'needs-input': { title: 'Agent needs input', severity: 'warning' },
  completed: { title: 'Agent turn completed', severity: 'info' },
  failed: { title: 'Agent turn failed', severity: 'error' }
} satisfies Record<string, { title: string; severity: NotificationSeverity }>

export function receiveAgentNotification({
  provider,
  providerSessionId,
  terminalId,
  message
}: AgentNotification): void {
  const source = `${AGENT_PROVIDERS[provider]} · ${providerSessionId}`
  const explicit = message.kind === 'explicit'
  const content = explicit
    ? { title: message.title || 'Agent message', severity: 'info' as const }
    : stateNotices[message.kind]
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
    { showToast: explicit || !document.hasFocus() || !isTerminalShown(terminalId) }
  )
}
