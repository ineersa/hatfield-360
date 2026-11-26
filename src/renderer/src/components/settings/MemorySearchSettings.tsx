import { useState, type FormEvent } from 'react'
import { useSettingsStore } from '@/state/settings-store'
import { LIBRARIAN_TIMEOUT_RANGE } from '../../../../shared/settings-api'
import { NumberStepper } from './NumberStepper'
import { ResetButton } from './ResetButton'

const inputClass =
  'type-body h-control w-full rounded-component border border-separator bg-island px-2 py-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

/** Where memory search finds Librarian: its MCP endpoint, a request time limit and an optional token. */
export function MemorySearchSettings(): React.JSX.Element {
  const url = useSettingsStore((state) => state.values['memory.librarianUrl'])
  const timeout = useSettingsStore((state) => state.values['memory.librarianTimeoutSeconds'])
  const tokenVariable = useSettingsStore((state) => state.values['memory.librarianTokenVariable'])
  const editable = useSettingsStore((state) => state.editable)
  const update = useSettingsStore((state) => state.update)
  const [error, setError] = useState<string | null>(null)

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const nextUrl = data.get('url')
    const nextVariable = data.get('tokenVariable')
    if (typeof nextUrl !== 'string' || typeof nextVariable !== 'string') return
    const saved =
      (await update('memory.librarianUrl', nextUrl.trim())) &&
      (await update('memory.librarianTokenVariable', nextVariable.trim()))
    setError(
      saved
        ? null
        : 'Use an absolute http(s) URL without credentials, query or fragment, and a variable name such as LIBRARIAN_TOKEN.'
    )
  }

  return (
    <section className="flex flex-col gap-2 py-4" aria-label="Memory search">
      <div>
        <h2 className="type-section-title">Memory search</h2>
        <p className="type-description">
          Search Memory (Ctrl+K / ⌘K) asks a Librarian server for the observations and reflections
          agents kept in a project. Leave the endpoint empty to turn it off.
        </p>
      </div>
      <form
        key={JSON.stringify([url, tokenVariable])}
        onSubmit={(event) => void save(event)}
        className="flex flex-col gap-2"
      >
        <label className="type-description">
          Librarian MCP endpoint
          <span className="flex items-center gap-2">
            <input
              name="url"
              type="text"
              inputMode="url"
              defaultValue={url}
              placeholder="http://127.0.0.1:8093/_mcp"
              spellCheck={false}
              disabled={!editable}
              className={inputClass}
            />
            <ResetButton settingKey="memory.librarianUrl" label="Librarian MCP endpoint" />
          </span>
        </label>
        <label className="type-description">
          Token environment variable (optional)
          <span className="flex items-center gap-2">
            <input
              name="tokenVariable"
              type="text"
              defaultValue={tokenVariable}
              placeholder="LIBRARIAN_TOKEN"
              spellCheck={false}
              disabled={!editable}
              className={inputClass}
            />
            <ResetButton
              settingKey="memory.librarianTokenVariable"
              label="Librarian token environment variable"
            />
          </span>
        </label>
        <p className="type-hint">
          The app reads the bearer token from this variable when it searches, so the token never
          lands in settings.json. Leave it empty for a server without authentication.
        </p>
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
            Save Librarian connection
          </button>
        </div>
      </form>
      <div className="flex items-center gap-2">
        <span className="type-description">Time limit per request (seconds)</span>
        <NumberStepper
          label="Librarian time limit in seconds"
          value={timeout}
          range={LIBRARIAN_TIMEOUT_RANGE}
          disabled={!editable}
          onChange={(next) => void update('memory.librarianTimeoutSeconds', next)}
        />
        <ResetButton settingKey="memory.librarianTimeoutSeconds" label="Librarian time limit" />
      </div>
    </section>
  )
}
