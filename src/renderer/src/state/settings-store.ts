import { create } from 'zustand'
import { mainErrorMessage } from '@/lib/main-error-message'
import { followNotice, notify } from '@/state/notification-store'
import {
  DEFAULT_SETTINGS,
  type SettingKey,
  type Settings,
  type SettingsView
} from '../../../shared/settings-api'

type SettingsState = {
  /** Defaults until main answers, so the UI never waits on settings. */
  values: Settings
  /** True once main has answered; until then `values` are the defaults, not the user's settings. */
  loaded: boolean
  customized: SettingKey[]
  editable: boolean
  /** Loads settings and follows every save of settings.json; returns the unsubscribe. */
  connect: () => () => void
  /** null resets the setting to its default. Resolves to whether main saved it. */
  update: <K extends SettingKey>(key: K, value: Settings[K] | null) => Promise<boolean>
  /** Puts every setting back to its default; stops at the first one main refuses. */
  resetAll: () => Promise<void>
  openFile: () => Promise<void>
}

const failed = (error: unknown): void => {
  notify({ severity: 'error', title: 'Settings', body: mainErrorMessage(error) })
}

export const useSettingsStore = create<SettingsState>((set, get) => {
  // Problems in settings.json: the app keeps the values it could use, so they are warnings.
  const showNotice = followNotice((body) => ({
    severity: 'warning',
    title: 'Settings',
    body,
    action: { label: 'Open settings.json', run: () => void get().openFile() }
  }))
  const apply = ({ values, customized, editable, notice }: SettingsView): void => {
    set({ values, loaded: true, customized, editable })
    showNotice(notice)
  }
  return {
    values: DEFAULT_SETTINGS,
    loaded: false,
    customized: [],
    editable: true,
    connect: () => {
      const unsubscribe = window.desktop.subscribeSettings(apply)
      window.desktop.getSettings().then(apply, failed)
      return unsubscribe
    },
    update: async (key, value) => {
      // Shown at once; main's answer (checked, clamped) replaces it, or a failure puts the old value back.
      const previous = get().values
      if (value !== null) set({ values: { ...previous, [key]: value } })
      try {
        await window.desktop.updateSetting(key, value)
        return true
      } catch (error) {
        set({ values: previous })
        failed(error)
        return false
      }
    },
    resetAll: async () => {
      for (const key of get().customized) {
        if (!(await get().update(key, null))) return
      }
    },
    openFile: () => window.desktop.openSettingsFile().catch(failed)
  }
})
