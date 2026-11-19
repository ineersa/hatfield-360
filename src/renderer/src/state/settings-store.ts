import { create } from 'zustand'
import { DEFAULT_SETTINGS, type Settings, type SettingsView } from '../../../shared/settings-api'

type SettingsState = {
  /** Defaults until main answers, so the UI never waits on settings. */
  values: Settings
  notice: SettingsView['notice']
  /** The id of the notice the user closed; the next notice shows again. */
  dismissedNoticeId: number | null
  dismissNotice: () => void
  /** Loads settings and follows every save of settings.json; returns the unsubscribe. */
  connect: () => () => void
}

export const useSettingsStore = create<SettingsState>((set, get) => {
  const apply = ({ values, notice }: SettingsView): void => set({ values, notice })
  return {
    values: DEFAULT_SETTINGS,
    notice: null,
    dismissedNoticeId: null,
    dismissNotice: () => set({ dismissedNoticeId: get().notice?.id ?? null }),
    connect: () => {
      const unsubscribe = window.desktop.subscribeSettings(apply)
      window.desktop
        .getSettings()
        .then(apply)
        .catch((error: unknown) =>
          set({
            notice: {
              id: -1,
              message: `Settings could not be loaded: ${error instanceof Error ? error.message : String(error)}`
            }
          })
        )
      return unsubscribe
    }
  }
})
