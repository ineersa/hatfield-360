import { Check, ChevronDown, Volume2 } from 'lucide-react'
import { useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { playAgentNotificationSound } from '@/lib/agent-notification-sound'
import { useSettingsStore } from '@/state/settings-store'
import {
  AGENT_SOUNDS,
  AGENT_SOUND_IDS,
  AGENT_SOUND_KEYS,
  type AgentSound
} from '../../../../shared/agent-sound-catalog'
import { ResetButton } from './ResetButton'

const events = [
  { label: 'Completed', key: AGENT_SOUND_KEYS.completed },
  { label: 'Needs input', key: AGENT_SOUND_KEYS['needs-input'] },
  { label: 'Failed', key: AGENT_SOUND_KEYS.failed }
] as const

type SoundEvent = (typeof events)[number]

function SoundPicker({
  event,
  playing,
  preview
}: {
  event: SoundEvent
  playing: boolean
  preview: (sound: AgentSound, eventLabel: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const current = useSettingsStore((state) => state.values[event.key])
  const editable = useSettingsStore((state) => state.editable)
  const update = useSettingsStore((state) => state.update)
  const label = `${event.label} sound`
  return (
    <div className="flex flex-col gap-1">
      <span className="type-section-title">{event.label}</span>
      <div className="flex flex-wrap items-center gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`${label}: ${AGENT_SOUNDS[current]}`}
              disabled={!editable}
              className="flex h-control min-w-0 flex-1 items-center gap-2 rounded-component border border-input-border bg-input px-2.5 text-left text-input-foreground outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              <span className="min-w-0 flex-1 truncate">{AGENT_SOUNDS[current]}</span>
              <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </button>
          </PopoverTrigger>
          <PopoverContent
            aria-label={label}
            align="start"
            className="flex max-h-72 w-(--radix-popover-trigger-width) min-w-48 max-w-(--radix-popover-content-available-width) flex-col overflow-y-auto"
            onKeyDown={(keyboardEvent) => {
              if (keyboardEvent.key === 'Escape') keyboardEvent.stopPropagation()
            }}
          >
            {AGENT_SOUND_IDS.map((sound) => (
              <button
                key={sound}
                type="button"
                aria-pressed={sound === current}
                disabled={!editable}
                onClick={() => {
                  void update(event.key, sound)
                  setOpen(false)
                }}
                className="flex h-list-row shrink-0 items-center justify-between gap-2 rounded-component px-2 text-left outline-none hover:bg-popover-selection hover:text-popover-selection-foreground focus-visible:bg-popover-selection focus-visible:text-popover-selection-foreground"
              >
                {AGENT_SOUNDS[sound]}
                {sound === current && <Check className="size-4 shrink-0" aria-hidden />}
              </button>
            ))}
          </PopoverContent>
        </Popover>
        <button
          type="button"
          aria-label={`Preview ${event.label}`}
          disabled={playing}
          onClick={() => preview(current, event.label)}
          className="type-button flex h-control items-center gap-2 rounded-button border border-separator px-2.5 hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          <Volume2 aria-hidden className="size-4" />
          Preview
        </button>
        <ResetButton settingKey={event.key} label={label} />
      </div>
    </div>
  )
}

export function AgentSoundPreviews(): React.JSX.Element {
  const [playing, setPlaying] = useState(false)
  const [result, setResult] = useState('')
  async function preview(sound: AgentSound, eventLabel: string): Promise<void> {
    setPlaying(true)
    setResult('')
    const played = await playAgentNotificationSound(sound)
    setResult(
      played
        ? `${eventLabel} preview finished: ${AGENT_SOUNDS[sound]}.`
        : 'Audio preview unavailable.'
    )
    setPlaying(false)
  }
  return (
    <div className="flex flex-col gap-2 pb-4" role="group" aria-label="Agent sound presets">
      {events.map((event) => (
        <SoundPicker
          key={event.key}
          event={event}
          playing={playing}
          preview={(sound, label) => void preview(sound, label)}
        />
      ))}
      <p className="type-description" role="status" aria-label="Sound preview result">
        {result}
      </p>
    </div>
  )
}
