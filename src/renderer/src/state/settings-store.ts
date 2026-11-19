import { create } from 'zustand'
import {
  DEFAULT_SETTINGS,
  type SettingKey,
  type Settings,
  type SettingsView
} from '../../../shared/settings-api'

type SettingsState = {
  /** Defaults until main answers, so the UI never waits on settings. */
  values: Settings
  customized: SettingKey[]
  editable: boolean
  notice: SettingsView['notice']
  /** Why the last change from the Settings page failed. */
  error: string | null
  /** The id of the notice the user closed; the next notice shows again. */
  dismissedNoticeId: number | null
  dismissMessage: () => void
  /** Loads settings and follows every save of settings.json; returns the unsubscribe. */
  connect: () => () => void
  /** null resets the setting to its default. */
  update: <K extends SettingKey>(key: K, value: Settings[K] | null) => Promise<void>
  openFile: () => Promise<void>
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Electron prefixes errors thrown in main with "Error invoking remote method '<channel>': Error: ". */
const mainErrorMessage = (error: unknown): string =>
  message(error).replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '')

export const useSettingsStore = create<SettingsState>((set, get) => {
  const apply = ({ values, customized, editable, notice }: SettingsView): void =>
    set({ values, customized, editable, notice })
  const run = async (action: () => Promise<void>): Promise<void> => {
    try {
      await action()
      set({ error: null })
    } catch (error) {
      set({ error: mainErrorMessage(error) })
    }
  }
  return {
    values: DEFAULT_SETTINGS,
    customized: [],
    editable: true,
    notice: null,
    error: null,
    dismissedNoticeId: null,
    dismissMessage: () => set({ error: null, dismissedNoticeId: get().notice?.id ?? null }),
    connect: () => {
      const unsubscribe = window.desktop.subscribeSettings(apply)
      void run(async () => apply(await window.desktop.getSettings()))
      return unsubscribe
    },
    update: (key, value) => run(() => window.desktop.updateSetting(key, value)),
    openFile: () => run(() => window.desktop.openSettingsFile())
  }
})
