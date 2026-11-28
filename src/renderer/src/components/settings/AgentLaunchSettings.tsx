import { useState, type FormEvent } from 'react'
import { AGENT_PROVIDERS, type AgentProvider } from '../../../../shared/agent-api'
import { checkAgentProfile } from '../../../../shared/agent-profile'
import { isPlainObject } from '../../../../shared/plain-object'
import { useSettingsStore } from '@/state/settings-store'
import { ResetButton } from './ResetButton'

const inputClass =
  'type-body w-full rounded-component border border-separator bg-island px-2 py-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

/** The parsed JSON, or undefined when it isn't JSON. */
function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

function ProfileFields({ provider }: { provider: AgentProvider }): React.JSX.Element {
  const key = `agents.${provider}` as const
  const profile = useSettingsStore((state) => state.values[key])
  const editable = useSettingsStore((state) => state.editable)
  const update = useSettingsStore((state) => state.update)
  const [error, setError] = useState<string | null>(null)
  const label = AGENT_PROVIDERS[provider]

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const executable = data.get('executable')
    const rawArgs = data.get('args')
    const rawEnv = data.get('env')
    if (typeof executable !== 'string' || typeof rawArgs !== 'string' || typeof rawEnv !== 'string')
      return
    const args = parsedJson(rawArgs)
    if (
      !Array.isArray(args) ||
      !args.every((value: unknown): value is string => typeof value === 'string')
    ) {
      setError('Arguments must be a JSON array of strings, for example ["--flag"].')
      return
    }
    const env = rawEnv.trim() === '' ? {} : parsedJson(rawEnv)
    if (!isPlainObject(env)) {
      setError('Environment must be a JSON object of strings, for example {"FOO": "bar"}.')
      return
    }
    const checked = checkAgentProfile({ executable, args, env })
    if ('problem' in checked) {
      setError(`${label} ${checked.problem}.`)
      return
    }
    setError((await update(key, checked.value)) ? null : 'Could not save this launch profile.')
  }

  return (
    <form
      key={JSON.stringify(profile)}
      onSubmit={(event) => void save(event)}
      className="flex flex-col gap-2 py-3"
    >
      <h3 className="type-section-title">{label}</h3>
      <label className="type-description">
        {label} executable
        <input
          name="executable"
          defaultValue={profile.executable}
          required
          disabled={!editable}
          className={`${inputClass} h-control`}
        />
      </label>
      <label className="type-description">
        {label} arguments (JSON array)
        <input
          name="args"
          defaultValue={JSON.stringify(profile.args)}
          required
          disabled={!editable}
          className={`${inputClass} h-control`}
        />
      </label>
      <label className="type-description">
        {label} environment (JSON object)
        <input
          name="env"
          defaultValue={JSON.stringify(profile.env)}
          disabled={!editable}
          className={`${inputClass} h-control`}
        />
      </label>
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
          Save {label} profile
        </button>
        <ResetButton settingKey={key} label={`${label} launch profile`} />
      </div>
    </form>
  )
}

export function AgentLaunchSettings(): React.JSX.Element {
  return (
    <section className="py-4" aria-label="Agent launch profiles">
      <h2 className="type-section-title">Agent launch profiles</h2>
      <p className="type-description">
        The executable is one program: a name on your shell&apos;s PATH or a path. Put a
        wrapper&apos;s program here and the rest in Arguments, for example caffeinate with
        [&quot;-i&quot;, &quot;claude&quot;]. Relative paths with a separator start from the launch
        folder. Arguments are passed literally, not interpreted as shell source, except that a
        leading ~/ means your home folder. Environment adds variables to the agent&apos;s
        environment. On Windows, use a native .exe, not a command or PowerShell shim.
      </p>
      <ProfileFields provider="hatfield" />
      <ProfileFields provider="claude" />
      <p className="type-hint">
        The workspace chat (New Chat) and commit messages run Claude Code from this profile, with
        its arguments and environment, and its own login: API keys in the environment are not used.
      </p>
    </section>
  )
}
