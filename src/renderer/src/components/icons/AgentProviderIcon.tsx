import claude from '@/assets/claudecode-color.svg'
import hatfield from '@/assets/hatfield-plushie.svg'
import { cn } from '@/lib/class-names'
import type { AgentProvider } from '../../../../shared/agent-api'

export function AgentProviderIcon({
  provider,
  className
}: {
  provider: AgentProvider
  className?: string
}): React.JSX.Element {
  return (
    <img
      src={provider === 'hatfield' ? hatfield : claude}
      alt=""
      className={cn('size-5 shrink-0 object-contain', className)}
      aria-hidden
    />
  )
}
