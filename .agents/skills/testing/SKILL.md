---
name: testing
description: 'Load before writing, changing or deleting tests, or deciding how to prove a change works (unit vs E2E layer, focused runs).'
---

# Testing

Read [test anti-patterns](../../../docs/agents/test-antipatterns.md) first. Default is **no new test**. Add one only if it fails when your change is reverted and checks hardcoded expected values.

## Pick the single layer that owns the behavior

| Behavior                                                  | Layer                                  | Where                            |
| --------------------------------------------------------- | -------------------------------------- | -------------------------------- |
| Pure logic in main/shared (parsing, policies, state)      | Vitest, `node` project                 | `*.test.ts` beside the source    |
| Renderer logic without layout (stores, hooks, formatting) | Vitest, `renderer` project (happy-dom) | `*.test.ts(x)` beside the source |
| Anything rendered, IPC wiring, window behavior            | Playwright Electron E2E                | `tests/e2e/*.spec.ts`            |

happy-dom has no layout or paint, so pixels, visibility and focus are proven in E2E only. Extract logic out of Electron-bound modules (see `src/main/window/window-launch-mode.ts`) instead of mocking `electron`.

## Running

- Focused: `pnpm test src/main/window` or `pnpm test --project node`.
- Watch: `pnpm test:watch`.
- E2E: `pnpm test:e2e` builds and runs all specs; `pnpm exec playwright test --config config/playwright.config.mts -g "<title>"` re-runs one spec against the current build. No display: prefix with `xvfb-run -a`.
- Full gate before handing off: `pnpm check` (+ `pnpm test:e2e` for rendered/IPC changes).

## Rules

- Fake timers (`vi.useFakeTimers()`) instead of real waits. No network.
- One case per distinct behavior. No Cartesian `it.each`.
- Prefer real collaborators. A fake goes in one shared typed module, not copied per file.
- E2E asserts by role, label or `data-testid`. Each spec launches its own app with `APP_BACKGROUND_LAUNCH=1` and closes it in `finally`.
- A test you touch that matches an anti-pattern gets deleted, not updated.
