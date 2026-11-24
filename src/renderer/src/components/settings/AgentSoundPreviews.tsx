import { Volume2 } from 'lucide-react'
import { useState } from 'react'
import { agentNotificationCues, playAgentNotificationSound } from '@/lib/agent-notification-sound'

const cues = ['completed', 'needs-input', 'failed'] as const

export function AgentSoundPreviews(): React.JSX.Element {
  const [playing, setPlaying] = useState(false)
  const [result, setResult] = useState('')
  async function preview(cue: (typeof cues)[number]): Promise<void> {
    setPlaying(true)
    setResult('')
    const played = await playAgentNotificationSound(cue)
    setResult(
      played
        ? `${agentNotificationCues[cue].label} preview finished.`
        : 'Audio preview unavailable.'
    )
    setPlaying(false)
  }
  return (
    <div className="pb-4">
      <div
        role="group"
        aria-label="Preview agent notification sounds"
        className="flex flex-wrap gap-2"
      >
        {cues.map((cue) => (
          <button
            key={cue}
            type="button"
            disabled={playing}
            onClick={() => void preview(cue)}
            className="type-button flex h-control items-center gap-2 rounded-button border border-separator px-2.5 hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
          >
            <Volume2 aria-hidden className="size-4" />
            Preview {agentNotificationCues[cue].label}
          </button>
        ))}
      </div>
      <p className="type-description pt-1" role="status">
        {result}
      </p>
    </div>
  )
}
