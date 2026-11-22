# Explicit agent launches

Right-click a workspace project or linked worktree and choose **Launch Hatfield** or **Launch Claude** to use that directory in a new terminal tab. In an existing terminal, **Launch Hatfield in New Split** and **Launch Claude in New Split** start a separate process in the pane's original launch directory. The app does not inspect the shell's current directory after `cd`, send launch text to it, or replace the existing process. Commands typed in an ordinary shell are not tracked.

In **Settings → Agent launch profiles**, configure an executable and a JSON array of arguments for each provider. Defaults are `hatfield` and `claude` with no arguments. Use an executable on the app's `PATH` or give its absolute path. Relative paths containing a path separator, such as `./bin/hatfield`, resolve from the launch working directory. Arguments are passed directly, not expanded by a shell. To use a sandbox wrapper, set that wrapper as the executable; Hatfield 360 does not fall back to the unwrapped agent.

```json
{
  "agents.hatfield": { "executable": "hatfield-safe", "args": [] },
  "agents.claude": { "executable": "claude", "args": [] }
}
```

The app starts each agent in its own PTY. On Linux and macOS, that process receives `H360_STATUS_ENDPOINT`, `H360_STATUS_LAUNCH_ID` and `H360_STATUS_TOKEN` for the [local status socket](agent-status-protocol.md). These are child-process environment variables, not settings, command-line arguments or renderer data. Report the registered profile's provider (`hatfield` or `claude`); a different reported provider cannot change the row's identity. Windows launches do not get reporting credentials because v1 does not implement a Windows transport. On Windows only native `.exe` launches are supported (including a bare native executable name). `.cmd`, `.bat`, and `.ps1` profiles, including npm command shims, are not supported. For a Node-based agent, configure native `node.exe` as the executable and pass the actual script path as the first argument.

The status filters are **Working**, **Needs input**, **Idle**, and **Stopped**. **Idle** uses a green checkmark and includes completed turns once no work or waits remain. A live process without current activity reporting shows **Running**, not Working or Idle. **Stopped** covers settled failed and cancelled turns as well as ended processes; the row retains the last-turn outcome when available. The sidebar shows the last reported activity, wait category and turn outcome, not the actual question or an invented conversation title. Click a session or attention row to select its terminal if still open. Exit is separate from turn completion; exited records are held in memory only. Provider adapters (#25), restart restoration and resume (#37), and Librarian search (#38) are separate work.

## Protocol walkthrough and test recording

The test-only `tests/e2e/fixtures/agent-scenario.mjs` is a real Unix-socket reporter, not a provider plugin. To try it manually, temporarily configure the executable as an absolute path to Node and the arguments as `["/absolute/path/to/tests/e2e/fixtures/agent-scenario.mjs", "hatfield", "demo", "manual"]`. Launch Hatfield from the project context menu. After `Scenario ready`, type one command per line in the new terminal: `start`, `tool`, `wait`, `resolve`, `completed`, `again`, `failed`, `quit`. Each event step prints an acknowledgement without printing the credential. The fixture also supports `child`, `child-done`, `cancelled`, `duplicate` and `stale`. Restore your profile afterward.

Run the hidden Electron tests and record the representative scenario:

```sh
pnpm build
E2E_AGENT_DEMO=1 pnpm exec playwright test --config config/playwright.config.mts agents.spec.ts --workers=1
```

On Linux without a display, insert `xvfb-run -a` before `pnpm exec`. Recording is opt-in; Playwright's FFmpeg support must be installed (`pnpm exec playwright install ffmpeg`). The test saves the working, needs-input and outcome screenshots, `trace.zip`, and `agent-sessions.webm` under `test-results/agents-demo/`. Open the trace with `pnpm exec playwright show-trace test-results/agents-demo/trace.zip`. Screenshots and recording are evidence, not baselines. These scenarios prove app integration, not real provider hook behavior.

The Working filter includes actively working child agents and reported background scripts. A blocked actor does not count as working, but a session can need input while other actors or scripts continue. Missing background telemetry is never represented as a reported zero. Use `child-working`/`child-done` and `script`/`script-done` in the Hatfield scenario to see the independent counters.
