import { CopyableCommand } from './CopyableCommand'

/** Ways to install hunk; any one will do. */
const INSTALL_COMMANDS = [
  'brew install hunk',
  'curl -fsSL https://hunk.dev/install.sh | sh',
  'mise use -g hunk',
  'npm i -g hunkdiff'
]

const SKILL_COMMAND = 'npx skills add modem-dev/hunk -g --skill hunk-review'

/** The two steps that make Review, Log and agent review work: hunk itself, then the agent skill. */
export function HunkSetupSteps(): React.JSX.Element {
  return (
    <section aria-labelledby="hunk-setup-title" className="flex flex-col gap-3">
      <h3 id="hunk-setup-title" className="type-section-title">
        Setup
      </h3>
      <ol className="flex list-outside list-decimal flex-col gap-5 pl-5 marker:text-muted-foreground">
        <li className="pl-1">
          <p className="type-body mb-2">Install hunk with any one of these:</p>
          <div className="flex flex-col gap-1.5">
            {INSTALL_COMMANDS.map((command) => (
              <CopyableCommand key={command} command={command} />
            ))}
          </div>
        </li>
        <li className="pl-1">
          <p className="type-body mb-2">Install the agent review skill:</p>
          <CopyableCommand command={SKILL_COMMAND} />
          <p className="type-description mt-2">
            An agent without a skill system can be told to run{' '}
            <code className="font-mono text-foreground">hunk skill show</code> and follow it.
          </p>
        </li>
      </ol>
    </section>
  )
}
