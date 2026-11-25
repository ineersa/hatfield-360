# Hatfield and Claude adapter handoff: status protocol v1

Implement against the [desktop snapshot contract](agent-status-protocol.md). Update both adapters directly and rebuild them alongside the app. The unfinished v1 protocol was simplified in place; the old granular format is not supported. The desktop implementation and scenario reporter do not prove that either real provider is fully wired.

## Adapter updates

- Keep scoped explicit launch credentials, Linux owner verification, and bounded fail-open socket delivery. Explicit credentials take precedence even when incomplete or rejected. Keep Linux bootstrap retry idempotent using the same live owner and instance ID; a hook subprocess is not the owner.
- Remove capabilities, actor topology, per-actor turns and wire-level wait/script start/end pairs. Maintain whatever provider bookkeeping is needed locally to publish the latest aggregates. Every full snapshot is itself a checkpoint; remove the lost-`session.started` ensure/replay machinery, not the separate Linux credential exchange.
- Allocate a new epoch at conversation selection and use a shared monotonic sequence across all reports in the launch. Send only the latest complete snapshot for the current selection, without letting a delayed hook overwrite it. Retry an unchanged event with its original identity or publish the latest state with a new sequence and event ID. `stale` does not confirm prior application.
- Include the provider’s canonical conversation title as `title` (up to 1024 Unicode scalar values) in each snapshot where available. Omission or `null` clears it. Never carry the previously selected conversation’s title into a new epoch.
- On the completed snapshot, include the final assistant message as `turn.response` (plain text, at most 2,000 Unicode scalar values; truncate before sending, since longer text makes the whole snapshot `invalid`). For Claude, the `Stop` hook's last assistant message is the source.
- Keep a single stable main response ID from work start through final response and subagent settling. A new logical response gets a new ID. Use stable attention episode IDs across repeated observations, fresh IDs for new requests, and a new snapshot on resolution or when another outstanding request becomes current.
- Map foreground work, true final response, failure and cancellation, tool progress/recovery, permission/question/external-input waits, subagent activity, script lifecycles, and conversation end from actual public lifecycle observations. Tool failure is not response failure; a paused response is not completed; process exit is separate. Explicit `notification` carries only additional messages, not duplicate lifecycle alerts.
- Publish separate best-effort subagent and script counts from provider observations, not a process census. For Claude, tracking by `agent_id` is sufficient when that is what the hooks expose. Report `0` when the tracker currently observes no active agents; no parent links or unique execution IDs are required. Document that reused IDs can make counts approximate. Use `null` when observations are unsupported, unavailable, or cannot be reconstructed, not simply because the API lacks unique execution IDs. Never default to zero for missing hooks. The app acts on the reported count: a completed response with reported zero subagents and no attention can go Idle and notify. Scripts are informational only.

## Wire examples

Send each object on its own line. Replace placeholder credentials with app-issued values. For explicit launches skip `launch.register`; for a Linux managed shell, send the bootstrap first on a fresh socket and use its returned `launchId` and `token` below.

```jsonl
{"version":1,"kind":"launch.register","bootstrapToken":"BOOTSTRAP_TOKEN","instanceId":"11111111-2222-4333-8444-555555555555","provider":"hatfield","owner":{"pid":2,"pidNamespace":"4026534665","startTicks":"1087562"}}
```

```jsonl
{"version":1,"kind":"session.snapshot","launchId":"LAUNCH_ID","token":"TOKEN","eventId":"e3","sequence":3,"sessionId":"conversation","sessionEpoch":1,"provider":"hatfield","turn":{"id":"turn-1","status":"working"},"attention":{"id":"request-1","reason":"permission"},"activeSubagents":1,"backgroundScripts":1,"tool":"Bash"}
{"version":1,"kind":"session.snapshot","launchId":"LAUNCH_ID","token":"TOKEN","eventId":"e4","sequence":4,"sessionId":"conversation","sessionEpoch":1,"provider":"hatfield","turn":{"id":"turn-1","status":"completed"},"attention":null,"activeSubagents":1,"backgroundScripts":1,"tool":null}
{"version":1,"kind":"session.snapshot","launchId":"LAUNCH_ID","token":"TOKEN","eventId":"e5","sequence":5,"sessionId":"conversation","sessionEpoch":1,"provider":"hatfield","turn":{"id":"turn-1","status":"completed"},"attention":null,"activeSubagents":0,"backgroundScripts":1,"tool":null}
{"version":1,"kind":"notification","launchId":"LAUNCH_ID","token":"TOKEN","eventId":"e6","sequence":6,"sessionId":"conversation","sessionEpoch":1,"title":"Review available","body":"The report is ready."}
{"version":1,"kind":"session.ended","launchId":"LAUNCH_ID","token":"TOKEN","eventId":"e7","sequence":7,"sessionId":"conversation","sessionEpoch":1}
```

The sequence-3 snapshot works even if no earlier snapshot arrived. Sequence 4 still represents Working. Sequence 5 permits green/Idle and one completion notice while the script indicator remains visible. A later conversation needs a new epoch; don't reopen this epoch after sequence 7.

## Provider acceptance still required

For each adapter, document implemented-and-tested, implemented-but-untested, missing and provider-blocked lifecycle mappings. Exercise the real provider through desktop explicit launch and supported Linux managed-shell paths, including wrapper ownership, conversation selection/resume, stable wait and outcome reporting, background settling, script independence, extra-message attribution and fail-open transport loss. CLI validation of a wire kind does not constitute automatic adapter wiring. No real-provider validation is claimed by this handoff.
