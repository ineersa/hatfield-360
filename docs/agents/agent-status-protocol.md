# Local agent status protocol v1

Hatfield 360 owns a status-only listener in Electron main. Linux/macOS use an AF_UNIX stream; Windows transport is deferred and the app runs without the listener. The socket is `status` under an app-created `h360-*` directory (0700), with socket mode 0600. The parent defaults to the system temporary directory (short `/tmp` on macOS), or main may supply an existing sandbox-visible parent. After resolving that parent, the socket path must fit in 103 UTF-8 bytes. A Linux probe connected from a real Node client launched through the local `pi-bwrap` wrapper to a socket with these permissions under the system temporary directory. This verifies visibility for that wrapper configuration, not other sandbox configurations or macOS.

## Launch ownership

Main-only `agentStatusServer` exposes `start`, `stop`, `registerLaunch({ terminalId, cwd })`, `markExited`, `revokeLaunch`, `snapshot` and `subscribe`. A trusted caller explicitly registers a launch (not an arbitrary shell); it supplies a terminal ID and cwd and receives `{ endpoint, launchId, token }`. There is no registration command on the socket. Main must call `markExited` on app-observed exit (or failed spawn); it disables credentials while retaining the last observation. Call `revokeLaunch` to discard the record. Neither `turn.ended` nor `session.ended` can change process status. An active registration is not proof a spawn succeeded. Exited records count against the launch limit until discarded.

Snapshots are detached copies and omit credentials. Subscribers receive detached changes (`registered`, `exited`, `revoked` or `event`) synchronously, with no history replay or tokens; use a snapshot for initial state. Only accepted events reach subscribers. UI notification policy is separate; explicit `notification` is for extra plain-text messages, not duplicate completion or input alerts. No renderer API, CLI, control requests, command/recipe fields, tool inputs/results, or transcripts are supported.

A launch credential authenticates status submission _for that launch_, not the official reporter; a tool subprocess can inherit and use it. Never place credentials in logs, snapshots or notifications. Treat all reporter strings as data, never markup. The directory prevents access by other OS users but does not isolate same-user processes.

## Framing and replies

Send UTF-8 JSON objects, one LF-terminated frame each. All fields are top-level. A connection may send one frame and wait for a reply without closing first, or send multiple frames and read one reply per frame in order. Disconnect never ends a session; an incomplete frame at EOF is discarded. Unknown fields are rejected. Each envelope requires `version: 1`, `launchId`, `token`, `eventId`, `sequence`, `sessionId`, `sessionEpoch`, and `kind`; optional `at` is diagnostic text (up to 64 Unicode scalar values). IDs (including `provider` and token) are 1–128 ASCII letters, digits or `_.:-`. Sequence and all start/epoch references are positive safe integers.

```jsonl
{"version":1,"launchId":"launch","token":"secret","eventId":"e1","sequence":1,"sessionId":"session","sessionEpoch":1,"kind":"session.started","provider":"example","capabilities":["waits"]}
{"version":1,"launchId":"launch","token":"secret","eventId":"e2","sequence":2,"sessionId":"session","sessionEpoch":1,"kind":"turn.started","actorId":"main","actorStart":1,"turnId":"turn"}
{"version":1,"launchId":"launch","token":"secret","eventId":"e3","sequence":3,"sessionId":"session","sessionEpoch":1,"kind":"turn.ended","actorId":"main","actorStart":1,"turnId":"turn","turnStart":2,"outcome":"completed"}
```

`{"ok":true,"status":"accepted"}` means applied; `duplicate` and `stale` are successful no-ops, not guarantees that a stale event was ever applied. Errors are `{"ok":false,"error":"<code>"}`: `invalid` (malformed encoding, JSON, fields), `version` (missing/unsupported version), `unauthorized` (unknown, mismatched, expired or revoked credential), `conflict` (recent accepted event ID reused with different content), `state` (invalid state reference, transition or missing capability), `limit` (resource/rate limit). An error does not advance the sequence. Connection saturation and deadline expiry can disconnect without a reply; overlong frames or excess frame count are terminal limits on that connection.

## Ordering and state

A launch has one monotonically increasing producer sequence shared across sessions and actors. Assign sequence and correlation at the causal observation boundary, not when a delayed hook happens to execute. Send in order if possible. An accepted sequence raises the launch high-water mark; gaps are allowed, and an event below or at the mark does not apply. The latest 128 accepted event IDs are checked before the high-water mark: retry the same envelope and ID (object key order is irrelevant); different content under a retained ID is a conflict. Always use unique event IDs even beyond the deduplication window. Sender timestamps are never used to order events.

For a new session, set `sessionEpoch` to the `session.started` sequence. This resets all actor, turn and wait state even if the provider session ID is reused. To re-register the same session, echo its epoch and original provider, session ID and capability set; registration does not reset state or reopen an ended session. The main actor is `main` and its start reference equals the session epoch. Child, turn and wait start references equal the sequence of the corresponding start event. This prevents delayed messages from targeting a reused ID. A child is independently tracked; ending its parent does not end it. An actor has at most one current turn; starting a new turn supersedes only that actor's previous turn and waits. Ending a turn clears only its waits and leaves process and child state unchanged. A tool error is not a turn outcome. `completed` doesn't assert task success. Before the first turn, activity is unknown. An ended session no longer accepts events other than same-session registration or a new session boundary.

| Kind               | Additional fields                                                                                                   | Capability      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- | --------------- |
| `session.started`  | `provider`, `capabilities` (unique names from this table)                                                           | —               |
| `session.ended`    | none                                                                                                                | `session-end`   |
| `actor.started`    | `actorId`, `parentId`, `parentStart` (parent must be active)                                                        | `actors`        |
| `actor.ended`      | `actorId`, `actorStart` (child only)                                                                                | `actors`        |
| `turn.started`     | actor reference (`actorId`, `actorStart`), `turnId`                                                                 | —               |
| `turn.ended`       | turn reference (actor reference, `turnId`, `turnStart`), `outcome`: `completed`, `failed`, `cancelled` or `unknown` | —               |
| `activity.changed` | turn reference, `activity`: `working` or `idle`; optional `tool` name (128 scalar values; shown only when working)  | —               |
| `wait.started`     | turn reference, `waitId`, `reason`: `permission`, `question` or `external-input`                                    | `waits`         |
| `wait.resolved`    | turn reference, `waitId`, `waitStart`                                                                               | `waits`         |
| `notification`     | `title` (200 scalar values), `body` (2,000)                                                                         | `notifications` |

Delivery is best effort; there is no spool, replay, heartbeat or guarantee of eventual convergence. An observation arriving after a later accepted event may be lost even when both were sent. A missed start can prevent its dependent updates; a missed end/resolution can leave stale state until a later accepted boundary. #25 must coordinate independent Claude hooks and determine which causal identities and capabilities it can reliably report; the server does not infer them.

## Limits

- 16 KiB per frame, excluding LF; invalid UTF-8 is rejected. Text lengths count Unicode scalar values, not graphemes or UTF-16 code units.
- 64 simultaneous connections; at most 32 frames plus one terminal limit reply per connection, with one fixed-size frame assembly buffer per connection. Each reply is below 64 bytes; writes are bounded by the frame count even if the peer doesn't read.
- Two seconds total server connection lifetime; recommend a sender deadline of at most one second with immediate failure on an absent endpoint.
- 64 launch records, 128 authenticated attempts per launch per monotonic one-second bucket (including retransmissions), 32 active actors per session including main, 16 outstanding waits per current actor turn, no notification history. Deduplication retains digests, not payloads.

### Background scripts (optional v1 capability)

Report `scripts` in `session.started` only when the adapter observes actual background Bash or code-mode job lifecycles. A consumer must not infer scripts from tool names or process lists. Without the capability the count is unknown, not zero.

- `script.started` adds `scriptId` (same syntax as actor IDs). Its `sequence` is the script's start reference.
- `script.ended` adds `scriptId` and `scriptStart` (the matching start sequence). Send it whenever the job ceases execution, including failure or cancellation; it does not report a parent turn outcome.

The usual credentials, session epoch, high-water sequence and retry rules apply. Jobs belong to the session epoch, not a turn or actor, so they survive parent completion. At most 32 can be active per session. A duplicate active ID or an end referring to a different start is rejected. A session boundary clears jobs; process exit retires the launch. A future scheduled job is not running until it actually starts.
