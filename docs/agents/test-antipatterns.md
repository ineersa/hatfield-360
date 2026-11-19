# Test anti-patterns

Keep a test only if it fails when your change is reverted, its expected values are hardcoded (not computed by production code), it lives at the one cheapest layer that owns the behavior, and its size matches the change (a one-line fix gets about one case).

Delete, don't update, tests that:

- Reimplement production logic, or use it as the oracle (`expect(out).toBe(buildX(input))`).
- Assemble production pieces instead of calling the real entry point.
- Assert nothing meaningful: `expect(true)`, lone `toBeDefined()`, `.not.toBe('')`, unpinned `toThrow()`.
- Assert only mock calls or values the mock itself supplied.
- Claim pixel, layout or interaction coverage from happy-dom markup or Tailwind class strings. Rendered UI is proven with Playwright against the real app.
- Re-test one contract at every layer (shared, IPC, renderer).
- Use Cartesian `it.each`, or branch inside a parameterized body, instead of one case per distinct behavior.
- Copy inventories, constants, defaults, versions, channel names or counts.
- Assert copy text that isn't the behavior under test.
- Test third-party behavior (React, zustand, Radix, Electron itself).
- Reach into private state or add test-only exports, globals or code paths to production code.
- Wait on real time or networks instead of fake timers and local fixtures.

Mocks that:

- Implement the behavior under test, or supply outputs production should generate.
- Contradict the real producer they stand in for.
- Are hand-copied across files instead of one shared typed fake.
