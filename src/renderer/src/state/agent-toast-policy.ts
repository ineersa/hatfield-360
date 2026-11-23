import type { AgentNotification } from '../../../shared/agent-api'

export function shouldShowAgentToast(
  kind: AgentNotification['message']['kind'],
  ownerWindowFocusedAndVisible: boolean,
  terminalShown: boolean
): boolean {
  return kind === 'explicit' || !ownerWindowFocusedAndVisible || !terminalShown
}
