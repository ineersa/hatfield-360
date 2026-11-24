import type { AgentSound } from '../../../shared/agent-sound-catalog'

const presets = {
  chime: {
    notes: [523.25, 659.25, 783.99],
    volume: 0.2,
    spacing: 0.19,
    duration: 0.28
  },
  'double-ring': {
    notes: [659.25, 880, 659.25, 880],
    volume: 0.28,
    spacing: 0.24,
    duration: 0.2
  },
  'low-alert': {
    notes: [392, 293.66, 220],
    volume: 0.24,
    spacing: 0.23,
    duration: 0.32
  },
  bell: { notes: [1046.5], volume: 0.21, spacing: 0.3, duration: 0.55, wave: 'sine' },
  marimba: { notes: [392, 523.25, 587.33, 783.99], volume: 0.22, spacing: 0.11, duration: 0.15 },
  fanfare: {
    notes: [523.25, 523.25, 783.99],
    volume: 0.22,
    spacing: 0.17,
    duration: 0.24,
    wave: 'sawtooth'
  },
  pulse: { notes: [740, 740, 740], volume: 0.23, spacing: 0.27, duration: 0.15 },
  'soft-knock': { notes: [262, 262], volume: 0.26, spacing: 0.17, duration: 0.16 },
  beacon: { notes: [988, 494, 988], volume: 0.23, spacing: 0.3, duration: 0.24, wave: 'sine' },
  'door-chime': { notes: [880, 659.25], volume: 0.23, spacing: 0.29, duration: 0.4 },
  ripple: {
    notes: [523.25, 783.99, 659.25, 1046.5, 783.99],
    volume: 0.2,
    spacing: 0.13,
    duration: 0.19
  },
  'falling-whistle': {
    notes: [1100],
    volume: 0.23,
    spacing: 0.3,
    duration: 0.65,
    wave: 'sine',
    endPitch: 440
  }
} satisfies Record<
  AgentSound,
  {
    notes: number[]
    volume: number
    spacing: number
    duration: number
    wave?: OscillatorType
    endPitch?: number
  }
>

let audio: AudioContext | undefined

export async function playAgentNotificationSound(
  sound: AgentSound,
  allowed: () => boolean = () => true
): Promise<boolean> {
  try {
    audio ??= new AudioContext()
    const context = audio
    if (context.state === 'suspended') await context.resume()
    if (context.state !== 'running' || !allowed()) return false

    const preset = presets[sound]
    const { notes, volume, spacing, duration } = preset
    const start = context.currentTime
    const finished = notes.map((frequency, index) => {
      const at = start + index * spacing
      const end = at + duration
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'wave' in preset ? preset.wave : 'triangle'
      oscillator.frequency.setValueAtTime(frequency, at)
      if ('endPitch' in preset)
        oscillator.frequency.exponentialRampToValueAtTime(preset.endPitch, end)
      gain.gain.setValueAtTime(0, at)
      gain.gain.linearRampToValueAtTime(volume, at + 0.02)
      gain.gain.setValueAtTime(volume, at + duration * 0.55)
      gain.gain.linearRampToValueAtTime(0, end)
      oscillator.connect(gain).connect(context.destination)
      const ended = new Promise<void>((resolve) => {
        oscillator.addEventListener(
          'ended',
          () => {
            oscillator.disconnect()
            gain.disconnect()
            resolve()
          },
          { once: true }
        )
      })
      oscillator.start(at)
      oscillator.stop(end)
      return ended
    })
    await Promise.all(finished)
    return true
  } catch {
    // Audio failure must not interrupt notification delivery.
    return false
  }
}
