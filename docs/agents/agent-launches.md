# Explicit agent launches

Right-click a workspace project or linked worktree and choose **Launch Hatfield** or **Launch Claude** to use that directory in a new terminal tab. In an existing terminal, **Launch Hatfield in New Split** and **Launch Claude in New Split** start a separate process in the pane's original launch directory. The app does not inspect the shell's current directory after `cd`, send launch text to it, or replace the existing process. Ordinary shells can also report manually started agents on Linux, as described below.

In **Settings → Agent launch profiles**, configure an executable and a JSON array of arguments for each provider. Defaults are `hatfield` and `claude` with no arguments. On Linux and macOS, explicit launches run the default Bash, Zsh or Fish shell's interactive startup (also login startup on macOS), then return to the requested directory and replace the shell with the configured executable. Use a command on the resulting `PATH` or give its absolute path. Relative paths containing a path separator, such as `./bin/hatfield`, resolve from the launch working directory. Arguments are passed literally, not interpreted as shell source. To use a sandbox wrapper, set that wrapper as the executable; Hatfield 360 does not fall back to the unwrapped agent.

```json
{
  "agents.hatfield": { "executable": "hatfield-safe", "args": [] },
  "agents.claude": { "executable": "claude", "args": [] }
}
```

The app starts each agent in its own PTY. On Linux and macOS, that process receives `H360_STATUS_ENDPOINT`, `H360_STATUS_LAUNCH_ID` and `H360_STATUS_TOKEN` for the [local status socket](agent-status-protocol.md). These are child-process environment variables, not settings, command-line arguments or renderer data. Report the registered profile's provider (`hatfield` or `claude`); a different reported provider cannot change the row's identity. Windows launches do not get reporting credentials because the status socket has no Windows transport. On Windows only native `.exe` launches are supported (including a bare native executable name). `.cmd`, `.bat`, and `.ps1` profiles, including npm command shims, are not supported. For a Node-based agent, configure native `node.exe` as the executable and pass the actual script path as the first argument.

The status filters are **Working**, **Needs input**, **Idle**, and **Stopped**. **Idle** uses a green checkmark and shows completed turns once the subagent count is known to be zero and no input is needed. A live process without current activity reporting has no status badge; its tooltip explains that activity has not been reported. **Stopped** is red and covers settled failed and cancelled turns; the row retains the last-turn outcome when available. The sidebar shows the last reported activity, wait category and turn outcome, not the actual question or an invented conversation title. Click a session row to select its terminal if still open. Process exit removes the session row and is separate from turn completion. A successful explicit agent exit closes its pane; errors and signals leave the output visible until closed. Closing a pane removes all its session rows. Provider adapters (#25), restart restoration and resume (#37), and Librarian search (#38) are separate work.

Agent notification sounds are enabled by default. In Settings, choose a preset independently for completion, needs input, and failure. **Preview** plays the selected preset even when **Agent notification sounds** is off. System or device muting still applies. Explicit provider messages are silent. Automatic sounds follow the toast policy: if the app is focused and the owning terminal is visible, the notification is kept in the panel without a toast or sound. If the notification panel is open, it replaces the toast visually, but an otherwise eligible cue still plays.

## Manual launches in managed shells (Linux)

Type the normal Hatfield or Claude command in an ordinary Hatfield 360 terminal. With a compatible extension/plugin, the agent is listed in Agents and its row opens that same pane. No command is intercepted and no wrapper is replaced. When the agent exits, its row disappears without closing the shell or clearing its output. Launching another process creates a new row. If process observation becomes unavailable, the app retires reporting and shows that the process status is unavailable, not that it exited. Up to 32 such retired manual rows per window are retained in memory while their owning panes remain open.

Placement uses the verified process's observed cwd at registration, including after `cd`. Only paths that resolve to the same directory on the host are used for workspace grouping; otherwise the app falls back to the pane's existing placement (typically Other terminals). Manual registration does not capture a launch profile or promise resume. External terminals, SSH, tmux's separate PTYs, macOS and Windows manual registration are not supported. Existing explicit launches are unchanged.

The registration environment and socket must reach the agent through any wrapper. The `pi-bwrap` boundary has been probed with a disposable process; real `hatfield-safe`, `castor run:agent` and Claude adapter acceptance must still be validated. See the [producer contract](agent-status-protocol.md#manual-launch-registration-linux).

## Protocol walkthrough and test recording

The test-only `tests/e2e/fixtures/agent-scenario.mjs` is a real Unix-socket reporter, not a provider plugin. To try it manually, temporarily configure the executable as an absolute path to Node and the arguments as `["/absolute/path/to/tests/e2e/fixtures/agent-scenario.mjs", "hatfield", "demo", "manual"]`. Launch Hatfield from the project context menu. After `Scenario ready`, type one command per line in the new terminal: `start`, `title`, `tool`, `wait`, `resolve`, `message`, `completed`, `again`, `failed`, `quit`. `title` reports an example conversation title. `message` sends an explicit in-app notification. Each event step prints an acknowledgement without printing the credential. The fixture also supports `child`, `child-done`, `cancelled`, `duplicate` and `stale`. Restore your profile afterward.

To check completion timing in a fresh scenario, run `start`, `child-working`, `script`, `completed`. Expect Working and no completion notice. `children-unknown` removes the known subagent count without proving completion. `child-done` reports zero and releases the completion notice with the script icon still visible. `script-done` removes the script count without sending another notice.

In a disposable project, `report-failure-on-hangup` arms the fixture to report a failed turn when you close the terminal during an open turn. It writes the server acknowledgement to `hangup-report` in the working directory. The report is accepted, but intentional closure suppresses the failure notice.

Run the hidden Electron tests and record the representative scenario:

```sh
pnpm build
E2E_AGENT_DEMO=1 pnpm exec playwright test --config config/playwright.config.mts agents.spec.ts --workers=1
```

On Linux without a display, insert `xvfb-run -a` before `pnpm exec`. Recording is opt-in; Playwright's FFmpeg support must be installed (`pnpm exec playwright install ffmpeg`). The test saves the working, needs-input and outcome screenshots, `trace.zip`, and `agent-sessions.webm` under `test-results/agents-demo/`. Open the trace with `pnpm exec playwright show-trace test-results/agents-demo/trace.zip`. Screenshots and recording are evidence, not baselines. These scenarios prove app integration, not real provider hook behavior.

The Working filter includes sessions whose main turn is working or which report active subagents; a session may need input while work continues. Scripts have an independent icon/count even in Idle. Missing background telemetry is never represented as a reported zero.

Terminal web links, including OSC 8 hyperlinks, open with Ctrl-click or Cmd-click. An unmodified click does not open the link.
