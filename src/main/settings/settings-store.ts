import { app } from 'electron'
import { DEFAULT_SETTINGS, type SettingKey, type SettingsView } from '../../shared/settings-api'
import { checkSettingValue, parseSettings, withSetting } from './settings-document'
import { UserConfigFile } from './user-config-file'

type SettingsState = Pick<SettingsView, 'values' | 'customized' | 'editable'>

/** The user's settings.json, reloaded and pushed to windows whenever the file changes. */
class SettingsStore extends UserConfigFile<SettingsState, SettingsView> {
  constructor(dataDir: () => string) {
    super(
      {
        name: 'settings.json',
        initial: { values: DEFAULT_SETTINGS, customized: [], editable: true },
        template: () => '{}\n',
        parse: (text, previous) => {
          const { problems, ...state } = parseSettings(text, previous.values)
          return { state, problems }
        },
        view: (state, notice) => ({ ...state, notice })
      },
      dataDir
    )
  }

  /** Writes one setting into settings.json (null resets it) and applies it right away. */
  update(key: SettingKey, value: unknown): Promise<void> {
    return this.rewrite((text, state) => {
      const checked = value === null ? null : checkSettingValue(key, value)
      if (!parseSettings(text, state.values).editable) {
        throw new Error(
          'settings.json has errors. Fix them in the file first (Open settings.json).'
        )
      }
      return withSetting(text, key, checked)
    })
  }
}

export const settingsStore = new SettingsStore(() => app.getPath('userData'))
