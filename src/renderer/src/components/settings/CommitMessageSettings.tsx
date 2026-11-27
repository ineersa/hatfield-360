import { useId, useState, type FormEvent } from 'react'
import { useSettingsStore } from '@/state/settings-store'
import {
  COMMIT_MESSAGE_EFFORTS,
  COMMIT_MESSAGE_INSTRUCTIONS_LIMIT,
  COMMIT_MESSAGE_MODELS,
  COMMIT_MESSAGE_PROVIDERS,
  type SettingKey
} from '../../../../shared/settings-api'
import { ResetButton } from './ResetButton'

const CHOICE =
  'relative flex h-control cursor-pointer items-center rounded-component border border-input-border px-3 has-checked:border-primary has-checked:bg-selection has-focus-visible:ring-2 has-focus-visible:ring-ring has-disabled:cursor-default has-disabled:opacity-50'

/** One choice of a setting, as a row of radio buttons. */
function Choices({
  settingKey,
  label,
  choices
}: {
  settingKey: 'git.commitMessage.provider' | 'git.commitMessage.model' | 'git.commitMessage.effort'
  label: string
  choices: readonly { value: string; name: string }[]
}): React.JSX.Element {
  const current = useSettingsStore((state) => state.values[settingKey])
  const editable = useSettingsStore((state) => state.editable)
  const update = useSettingsStore((state) => state.update)
  const labelId = useId()
  return (
    <div className="flex flex-col gap-1">
      <span id={labelId} className="type-description">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <div role="radiogroup" aria-labelledby={labelId} className="flex flex-wrap gap-2">
          {choices.map(({ value, name }) => (
            <label key={value} className={CHOICE}>
              <input
                type="radio"
                name={settingKey}
                value={value}
                checked={current === value}
                disabled={!editable}
                onChange={() => void update(settingKey, value)}
                className="sr-only"
              />
              {name}
            </label>
          ))}
        </div>
        <ResetButton settingKey={settingKey satisfies SettingKey} label={label} />
      </div>
    </div>
  )
}

/** How Generate in the Commit panel writes a message: Claude Code's model and effort, and the user's rules. */
export function CommitMessageSettings(): React.JSX.Element {
  const instructions = useSettingsStore((state) => state.values['git.commitMessage.instructions'])
  const editable = useSettingsStore((state) => state.editable)
  const update = useSettingsStore((state) => state.update)
  const [error, setError] = useState<string | null>(null)
  const headingId = useId()

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const next = new FormData(event.currentTarget).get('instructions')
    if (typeof next !== 'string') return
    const saved = await update('git.commitMessage.instructions', next.trim())
    setError(saved ? null : `Keep the rules under ${COMMIT_MESSAGE_INSTRUCTIONS_LIMIT} characters.`)
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 py-4">
      <div>
        <h3 id={headingId} className="type-section-title">
          Commit messages
        </h3>
        <p className="type-description">
          Generate in the Commit panel starts the agent, run from its profile in Agent launch
          profiles, asks it for a message and stops it. It sees the checked files’ names and line
          counts, reads a file’s diff only when it needs to, and follows the style of recent
          commits.
        </p>
      </div>
      <Choices
        settingKey="git.commitMessage.provider"
        label="Agent"
        choices={COMMIT_MESSAGE_PROVIDERS}
      />
      <Choices settingKey="git.commitMessage.model" label="Model" choices={COMMIT_MESSAGE_MODELS} />
      <Choices
        settingKey="git.commitMessage.effort"
        label="Effort"
        choices={COMMIT_MESSAGE_EFFORTS}
      />
      <form
        key={instructions}
        onSubmit={(event) => void save(event)}
        className="flex flex-col gap-2"
      >
        <label className="type-description">
          Your rules for commit messages (optional)
          <span className="flex items-start gap-2">
            <textarea
              name="instructions"
              rows={4}
              defaultValue={instructions}
              maxLength={COMMIT_MESSAGE_INSTRUCTIONS_LIMIT}
              placeholder="For example: use Conventional Commits; no body for small changes."
              spellCheck={false}
              disabled={!editable}
              className="type-body w-full resize-y rounded-component border border-input-border bg-input px-2 py-1 text-input-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            />
            <ResetButton settingKey="git.commitMessage.instructions" label="Commit message rules" />
          </span>
        </label>
        {error && (
          <p role="alert" className="type-hint text-error">
            {error}
          </p>
        )}
        <div>
          <button
            type="submit"
            disabled={!editable}
            className="type-button h-control rounded-button bg-primary px-3 text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
          >
            Save rules
          </button>
        </div>
      </form>
    </section>
  )
}
