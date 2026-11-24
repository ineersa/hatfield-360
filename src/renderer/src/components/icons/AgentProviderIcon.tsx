import claude from '@/assets/claudecode-color.svg'
import hatfield from '@/assets/hatfield-plushie.svg'
import type { AgentProvider } from '../../../../shared/agent-api'

export function AgentProviderIcon({ provider }: { provider: AgentProvider }): React.JSX.Element {
  return (
    <img
      src={provider === 'hatfield' ? hatfield : claude}
      alt=""
      className="size-5 shrink-0 object-contain"
      aria-hidden
    />
  )
}
