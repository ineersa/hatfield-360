# Workspace chat cassettes

Recorded ACP sessions between the app's chat client (`src/main/chat/chat-agent.ts`) and the real
Claude Code adapter (`@agentclientprotocol/claude-agent-acp`). Tests replay them in place of the
adapter, so they need no network, no login and no `claude` binary.

| File               | What it is                                                                                                                                                                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `repo/`            | The project every cassette was recorded in (copied to a temp folder first).                                                                                                                                                                                      |
| `<name>.jsonl`     | One session: a header line `{cassette, adapter, claude}`, then `{from: "client" \| "agent", message}` per JSON-RPC message, in order.                                                                                                                            |
| `acp-replayer.mjs` | Stands in for the adapter. Each client message must match the recording; one that doesn't makes it exit with a diff on stderr, which the chat shows. Agent messages are sent as soon as the client messages before them have arrived: nothing in a replay waits. |
| `acp-tee.mjs`      | Used while recording: runs the adapter and copies both directions to a log.                                                                                                                                                                                      |
| `cassette.mjs`     | Normalizing (paths, ids, times, the account's email) and matching, shared by both.                                                                                                                                                                               |

The app runs the replayer when `HATFIELD_CHAT_AGENT_SCRIPT` points at it, reading the cassette named by
`HATFIELD_CHAT_CASSETTE` (see `tests/e2e/chat.spec.ts` and `src/main/chat/chat-agent.test.ts`).

## Recording

```sh
pnpm record:chat-cassettes            # every cassette
pnpm record:chat-cassettes answer     # just one
```

This runs real Claude Code on Haiku and costs a few cents. It needs:

- `claude` on your shell's PATH, logged in (the chat never uses `ANTHROPIC_API_KEY`).

The scripts in `scripts/record-chat-cassettes.ts` say what each session does. Re-record after
upgrading the adapter: a unit test fails while a cassette's `adapter` differs from the installed
one. Check the diff before committing: the normalizer replaces your home folder, the project
folder, generated ids, timestamps and email addresses, and drops the account status and usage
messages the app ignores.
