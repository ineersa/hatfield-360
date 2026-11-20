import { RotateCcw } from 'lucide-react'
import { useSettingsStore } from '@/state/settings-store'
import type { SettingKey } from '../../../../shared/settings-api'

/** Puts one setting back to its default; shown only while the setting is customized. */
export function ResetButton({
  settingKey,
  label
}: {
  settingKey: SettingKey
  label: string
}): React.JSX.Element {
  const customized = useSettingsStore((state) => state.customized.includes(settingKey))
  const editable = useSettingsStore((state) => state.editable)
  const update = useSettingsStore((state) => state.update)
  // Keeps its place when hidden, so the fields line up across sections.
  if (!customized) return <span className="size-icon-button shrink-0" aria-hidden />
  return (
    <button
      type="button"
      aria-label={`Reset ${label}`}
      title="Reset to default"
      disabled={!editable}
      onClick={() => void update(settingKey, null)}
      className="flex size-icon-button shrink-0 items-center justify-center rounded-button text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <RotateCcw className="size-4" aria-hidden />
    </button>
  )
}
