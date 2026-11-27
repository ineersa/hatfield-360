import { RotateCcw } from 'lucide-react'
import type { ReactNode } from 'react'
import { ContextMenuItem } from '@/components/ui/context-menu'
import { useSettingsStore } from '@/state/settings-store'
import { DEFAULT_SETTINGS, type SettingKey } from '../../../../shared/settings-api'

/** Marks a setting's reset button (shown or not), so a right-click on its row can reset it too. */
export const SETTING_KEY_ATTRIBUTE = 'data-setting-key'
export const SETTING_LABEL_ATTRIBUTE = 'data-setting-label'

const isSettingKey = (key: string | null): key is SettingKey =>
  key !== null && Object.hasOwn(DEFAULT_SETTINGS, key)

/** The settings of the row right-clicked: the nearest ancestor that holds any reset button. */
function rowSettings(element: Element): { key: SettingKey; label: string }[] {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const marked = [...node.querySelectorAll(`[${SETTING_KEY_ATTRIBUTE}]`)]
    if (node.hasAttribute(SETTING_KEY_ATTRIBUTE)) marked.unshift(node)
    if (marked.length === 0) continue
    return marked.flatMap((each) => {
      const key = each.getAttribute(SETTING_KEY_ATTRIBUTE)
      const label = each.getAttribute(SETTING_LABEL_ATTRIBUTE) ?? key
      return isSettingKey(key) && label !== null ? [{ key, label }] : []
    })
  }
  return []
}

/** Reset to Default for each customized setting of the row right-clicked, as its reset button does. */
export function settingMenuItems(element: Element): ReactNode {
  const { customized, editable, update } = useSettingsStore.getState()
  const settings = rowSettings(element).filter(({ key }) => customized.includes(key))
  if (settings.length === 0) return null
  return settings.map(({ key, label }) => (
    <ContextMenuItem key={key} disabled={!editable} onSelect={() => void update(key, null)}>
      <RotateCcw aria-hidden />
      {settings.length === 1 ? 'Reset to Default' : `Reset ${label} to Default`}
    </ContextMenuItem>
  ))
}
