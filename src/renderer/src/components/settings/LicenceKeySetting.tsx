import { useId, useState, type FormEvent } from 'react'
import { useSettingsStore } from '@/state/settings-store'
import { ResetButton } from './ResetButton'

const LABEL = 'Intelephense licence key'

/** Intelephense's premium key, for PHP; servers started after a change use it. */
export function LicenceKeySetting(): React.JSX.Element {
  const key = useSettingsStore((state) => state.values['intelephense.licenceKey'])
  const editable = useSettingsStore((state) => state.editable)
  const update = useSettingsStore((state) => state.update)
  const [error, setError] = useState<string | null>(null)
  const descriptionId = useId()

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const value = new FormData(event.currentTarget).get('licenceKey')
    if (typeof value !== 'string') return
    setError((await update('intelephense.licenceKey', value)) ? null : "Couldn't save the key.")
  }

  return (
    <form key={key} onSubmit={(event) => void save(event)} className="flex flex-col gap-2 py-4">
      <label className="type-section-title" htmlFor={`${descriptionId}-input`}>
        {LABEL}
      </label>
      <p id={descriptionId} className="type-description">
        Unlocks Intelephense's premium PHP features. Leave it empty for the free features. Kept in
        settings.json as written; PHP files opened after saving use it.
      </p>
      <input
        id={`${descriptionId}-input`}
        name="licenceKey"
        type="password"
        autoComplete="off"
        spellCheck={false}
        defaultValue={key}
        disabled={!editable}
        aria-describedby={descriptionId}
        className="type-body h-control w-full rounded-component border border-separator bg-island px-2 py-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      />
      {error && (
        <p role="alert" className="type-hint text-error">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!editable}
          className="type-button h-control rounded-button bg-primary px-3 text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
        >
          Save licence key
        </button>
        <ResetButton settingKey="intelephense.licenceKey" label={LABEL} />
      </div>
    </form>
  )
}
