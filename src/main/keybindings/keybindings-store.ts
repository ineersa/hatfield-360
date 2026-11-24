import { app } from 'electron'
import type { KeybindingsView } from '../../shared/keybindings-api'
import { keybindingsTemplate } from '../../shared/keybindings-template'
import { UserConfigFile } from '../settings/user-config-file'
import { parseKeybindings } from './keybindings-document'

/** The user's keybindings.json, reloaded and pushed to windows whenever the file changes. */
export const keybindingsStore = new UserConfigFile<KeybindingsView['entries'], KeybindingsView>(
  {
    name: 'keybindings.json',
    initial: [],
    template: () => keybindingsTemplate(process.platform),
    parse: (text, previous) => {
      const { entries, problems } = parseKeybindings(text, process.platform)
      // A half-typed edit that doesn't parse keeps the keys in force.
      return { state: entries ?? previous, problems }
    },
    view: (entries, notice) => ({ entries, notice })
  },
  () => app.getPath('userData')
)
