export const AGENT_SOUNDS = {
  chime: 'Rising chime',
  'double-ring': 'Double ring',
  'low-alert': 'Low alert',
  bell: 'Desk bell',
  marimba: 'Marimba',
  fanfare: 'Fanfare',
  pulse: 'Triple pulse',
  'soft-knock': 'Soft knock',
  beacon: 'Beacon',
  'door-chime': 'Door chime',
  ripple: 'Ripple',
  'falling-whistle': 'Falling whistle'
} as const

export type AgentSound = keyof typeof AGENT_SOUNDS

export const AGENT_SOUND_IDS = Object.keys(AGENT_SOUNDS).filter((id): id is AgentSound =>
  Object.hasOwn(AGENT_SOUNDS, id)
)

export const AGENT_SOUND_KEYS = {
  completed: 'notifications.completedSound',
  'needs-input': 'notifications.needsInputSound',
  failed: 'notifications.failedSound'
} as const
