---
name: testing
description: 'Load before writing, changing or deleting tests, or deciding how to prove a change works (E2E vs integration vs unit, focused runs).'
---

# Testing

Read [test anti-patterns](../../../docs/agents/test-antipatterns.md) first.

**Policy:** prefer integration and real Electron E2E tests. Add a unit test only for a specific, meaningful behavior. Do not introduce mocks, stubs, `vi.mock`, `vi.stubGlobal`, spies standing in for collaborators, or fake implementations without explicit user authorization. If the behavior can't be reached through real collaborators, ask instead of faking it. Default is **no new test**; any test you add must fail when your change is reverted and check hardcoded expected values.

## Pick the single layer that owns the behavior

| Behavior                                                              | Layer                   | Where                         |
| --------------------------------------------------------------------- | ----------------------- | ----------------------------- |
| Anything rendered, IPC wiring, window behavior, user-visible flows    | Playwright Electron E2E | `tests/e2e/*.spec.ts`         |
| Pure logic with meaningful edge cases (parsing, validation, policies) | Vitest (node)           | `*.test.ts` beside the source |

Extract such logic out of Electron-bound modules into plain functions (see `src/main/ipc/trusted-sender.ts` and its test) instead of mocking `electron`. Pixels, visibility and focus are proven in E2E only.

## Running

- Focused unit run: `pnpm test src/main/ipc`.
- Watch: `pnpm test:watch`.
- E2E: `pnpm test:e2e` builds and runs all specs; `pnpm exec playwright test --config config/playwright.config.mts -g "<title>"` re-runs one spec against the current build. Linux without a display: prefix with `xvfb-run -a`.
- Complete gate before handing off: `pnpm verify`.
- `.only` fails the run (Vitest `allowOnly: false`, Playwright `forbidOnly: true`), so never commit it.

## Rules

- No real network. No timing in tests. A test must never depend on how fast anything runs: no sleeps, no polling or retry loops (`toPass`, `expect.poll`, `vi.waitFor`), no raised or custom timeouts, no time measurements, and no waiting on background work whose speed varies with load (language servers, file watchers, child processes). A test that can pass alone and fail under parallel load or contention does more harm than good: delete it or rewrite it to assert a deterministic outcome; never retry it, extend its timeout or rerun until green.
- One case per distinct behavior. No Cartesian `it.each`.
- E2E asserts by role, label or `data-testid`. Each spec launches its own app with `APP_BACKGROUND_LAUNCH=1` and closes it in `finally`.
- Screenshots are evidence, not assertions; no baseline comparison exists yet.
- A test you touch that matches an anti-pattern gets deleted, not updated.
