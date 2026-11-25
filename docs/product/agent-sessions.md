# Agent sessions: selected design and delivery plan

Design decisions from [#34](https://github.com/ineersa/hatfield-360/issues/34), with
[screenshots and alternatives](https://github.com/ineersa/hatfield-360/issues/34/artifacts/1).
This is a product plan, not a claim that the capabilities below are implemented.

## Terminal-first, detailed navigation

Preserve the actual terminal tabs and split panes. In the left sidebar, each
project heading shows its primary branch and is followed by a flat session list.
Linked worktrees are available afterward under a collapsed **Worktrees (N)**
disclosure. Toggling that disclosure does not hide sessions. The single-select
status filters use icon buttons with tooltips at narrow widths and show labels
when room allows. The sidebar scrolls independently; do not replace terminal
space with a dashboard or session table.

A compact one-line session row shows a provider icon, identity or title, and a
readable colored status icon and label. Hatfield uses `#ID — title`; Claude uses
the title alone. Without a reported title, use the Hatfield `#ID` or the first
eight characters of the Claude ID. The tooltip gives the full title and ID,
wait or tool details, background counts, and checkout and working-directory paths.
Use existing app theme roles and independently configured terminal themes.
Sessions appear newest-record-first within each project and in the attention
strip. Status, title, and conversation-selection updates do not
reorder existing records. A bounded attention strip above the tree keeps open
requests visible even when browsing filters hide the session. It names the reason
and opens the owning terminal, where the user answers or approves the request.
When empty, the section stays visible with a compact "No requests" state.
Stopped responses use the error colour; process exits remove the row instead.
Clicking a live session also selects its actual tab/pane.

Below each project's live sessions, a folded **Recent N** group lists closed
app-tracked conversations from the last 14 days, newest first. Rows show the
provider, reported title, differing branch and relative close time. Five rows
are shown initially; **Show N more** adds pages of 20. Resume opens a new tab,
Resume in Split uses the active tab, and an already open conversation selects
its existing pane. Remove from Recent deletes only desktop history, never the
provider's conversation. History survives restart but does not auto-launch.
The approved prototype is retained in `docs/design/issue-37-prototype/`.

Search is a project-scoped Librarian popup above the mounted terminal workspace,
not a new page or a separate transcript engine. Keyboard opening, Escape,
contained Tab navigation, prior-focus restoration and isolation from terminal
input are required. Search results show memory provenance and distinguish opening
a running terminal from resuming a historical session. Unmapped sources must not
pretend to be resumable.

## Explicit launches and identity

For v1, track only launches requested through the app. Project/worktree and
terminal context actions launch Hatfield or Claude using configured executable
and argument-array profiles, defaulting to `hatfield` and `claude`. Never infer
launches by watching typed shell commands or reconstruct a trusted launch recipe
from process inspection. Preserve configured sandbox wrappers.

Main owns the association between a logical agent session, an individual launch
and its terminal pane. Provider registration adds the provider conversation ID;
it does not authorize the reporter to select another pane. Launch credentials
stay out of renderer snapshots, logs and persistent settings.

Existing terminal actions must not type into or terminate an arbitrary editor,
busy shell or agent. Safe new-pane placement and known launch directories take
precedence over pretending to know shell idleness or a directory changed by `cd`.

The current workspace file saves terminal tabs, split layout, selection and pane-to-conversation mappings as they change. On reopen, ordinary panes get fresh shells. Agent panes use the provider's current Settings command with the saved conversation ID. A failed restore is reported without starting a substitute conversation.

## Honest information and limits

The status protocol separates process lifetime from the current main response,
attention and background counts. A completed response is not process exit. The
session turns green and notifies once only when that response is finished, the
subagent count is known to be zero, and no input is needed. Background scripts
have a separate indicator and do not block completion. Missing reporting never
implies success. Best-effort delivery cannot guarantee live-state convergence.

The protocol supplies provider identity, an optional bounded conversation title,
tool name and wait category, but not free-form questions. Use honest fallbacks
when metadata is absent. Bounded server launch records are not durable history.

Librarian searches retained memories by relevance, not all transcripts or a live
session catalog. Partial indexing, unavailable service, stale queries and unmapped
source sessions need explicit handling. Existing provider-history import and
manually typed launch detection are outside v1.

## Delivery slices and evidence

- [#36](https://github.com/ineersa/hatfield-360/issues/36): explicit launch profiles
  and actions, live pane ownership, A3 status wiring, protocol-driven Electron
  E2E tests and recorded demonstration.
- [#25](https://github.com/ineersa/hatfield-360/issues/25): real Claude/Hatfield
  protocol producers and provider-specific lifecycle/identity validation.
- [#37](https://github.com/ineersa/hatfield-360/issues/37): durable history,
  workspace autosave and automatic restart restoration.
- [#73](https://github.com/ineersa/hatfield-360/issues/73): continuation of #37's
  approved Recent history and explicit relaunch, with toast-only launch failures.
- [#38](https://github.com/ineersa/hatfield-360/issues/38): real Librarian search
  and source-session navigation/resume.

A test/development scenario client is explicitly authorized to exercise the real
launch path, PTY and status socket. Use acknowledged steps rather than sleeps;
assert visible state and exact pane selection without mocked bridges, stores or
servers. Capture screenshots for visual inspection and a Playwright video/trace
for human review, keeping automated Electron windows hidden and unfocused.
Protocol emulation proves app wiring; real-provider smoke tests must separately
prove hooks, sandbox access and actual conversation resume.
