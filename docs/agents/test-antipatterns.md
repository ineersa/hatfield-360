# Test anti-patterns

Keep a test only if it fails when your change is reverted, its expected values are hardcoded (not computed by production code), it lives at the one cheapest layer that owns the behavior, and its size matches the change (a one-line fix gets about one case).

Delete, don't update, tests that:

- Reimplement production logic, or use it as the oracle (`expect(out).toBe(buildX(input))`).
- Assemble production pieces instead of calling the real entry point.
- Assert nothing meaningful: `expect(true)`, lone `toBeDefined()`, `.not.toBe('')`, unpinned `toThrow()`.
- Assert only mock calls or values the mock itself supplied.
- Claim pixel, layout or interaction coverage from DOM-emulation markup or Tailwind class strings. Rendered UI is proven with Playwright against the real app.
- Re-test one contract at every layer (shared, IPC, renderer).
- Use Cartesian `it.each`, or branch inside a parameterized body, instead of one case per distinct behavior.
- Copy inventories, constants, defaults, versions, channel names or counts.
- Assert copy text that isn't the behavior under test.
- Test third-party behavior (React, zustand, Radix, Electron itself).
- Reach into private state or add test-only exports, globals or code paths to production code.
- Depend on real networks or sleep on wall-clock time.
- Use mocks, stubs, fakes, `vi.mock`, `vi.stubGlobal` or spies standing in for a collaborator. These need explicit user authorization; without it, test through the real collaborator (integration or E2E) or don't add the test.
