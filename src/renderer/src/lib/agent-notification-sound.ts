export const agentNotificationCues = {
  completed: { label: 'Completed', notes: [523.25, 659.25, 783.99] },
  'needs-input': { label: 'Needs input', notes: [659.25, 523.25] },
  failed: { label: 'Failed', notes: [392, 293.66] }
} as const

type Cue = keyof typeof agentNotificationCues
let audio: AudioContext | undefined

export async function playAgentNotificationSound(
  cue: Cue,
  allowed: () => boolean = () => true
): Promise<boolean> {
  try {
    audio ??= new AudioContext()
    const context = audio
    if (context.state === 'suspended') await context.resume()
    if (context.state !== 'running' || !allowed()) return false

    const notes = agentNotificationCues[cue].notes
    const start = context.currentTime
    const finished = notes.map((frequency, index) => {
      const at = start + index * 0.09
      const end = at + 0.13
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.frequency.value = frequency
      gain.gain.setValueAtTime(0, at)
      gain.gain.linearRampToValueAtTime(0.055, at + 0.012)
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
