# Hatfield 360

Electron desktop app: React renderer, Node main process, sandboxed preload bridge. What we are building and the target layout: [product vision](docs/product/vision.md). Package manager is pnpm (version pinned in `package.json`), runtime Node 24 (`.nvmrc`).

# Commands

| Purpose                   | Command                                                                         |
| ------------------------- | ------------------------------------------------------------------------------- |
| Install                   | `pnpm install --frozen-lockfile`                                                |
| Run app (dev, hot reload) | `pnpm dev` (agents: `APP_BACKGROUND_LAUNCH=1 pnpm dev`, see Electron UI below)  |
| Complete gate             | `pnpm verify` = `pnpm check` + `pnpm test:e2e` (what the task hooks run)        |
| Fast gate                 | `pnpm check` (format, lint incl. type-aware rules, typecheck, knip, unit tests) |
| Unit tests                | `pnpm test [path]`                                                              |
| E2E (builds first)        | `pnpm test:e2e` (Linux without a display: `xvfb-run -a pnpm test:e2e`)          |
| Package installers        | `pnpm package` (current OS only, into `release/`)                               |
| Format fix                | `pnpm format`                                                                   |
| Single tools              | `pnpm lint`, `pnpm typecheck`, `pnpm knip`                                      |

> [!IMPORTANT]
> Run `pnpm verify` after your last edit and before every push (`pnpm check` alone while iterating). Never `--no-verify`, and never silence a lint rule with a disable comment.

There is no PR CI: the task workflow's validate hook (`pnpm verify`) is the gate. `.github/workflows/release.yml` runs only for a published release or a manual dispatch; it runs `pnpm check`, packages the app on Linux, macOS and Windows, smoke-tests each packaged executable with the E2E spec and uploads the installers. Watch it with `gh run watch <run-id> --compact --exit-status`; don't poll.

# Architecture

```
src/main/      Electron main process (Node). Windows, IPC handlers, OS access.
src/preload/   contextBridge only. Exposes `window.desktop`; no logic.
src/renderer/  React UI (sandboxed web page). index.html + src/.
src/shared/    Types and constants used by every process. No electron, node:* or React imports.
config/        Tool configs (tsconfig per target, vitest, playwright, knip).
tests/e2e/     Playwright tests against the built Electron app.
```

Process boundary rules, enforced by lint (`.oxlintrc.json` overrides plus `config/oxlint/ipc-boundary-plugin.mjs`):

| Layer      | May import                                                                            |
| ---------- | ------------------------------------------------------------------------------------- |
| `main`     | main modules, `src/shared`, Node and Electron (named imports only)                    |
| `preload`  | `src/shared` and `contextBridge` / `ipcRenderer` from `electron`; no Node modules     |
| `renderer` | renderer modules (`@/`), `src/shared`, browser libraries; no Electron or Node modules |
| `shared`   | other `src/shared` code only; no Electron, Node, React or any process layer           |

- Windows keep `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`. Don't loosen them.
- The renderer talks to main only through `window.desktop`.
- Every IPC capability is declared once in `src/shared` (channel name + request/response types in `DesktopApi`), handled in `src/main/ipc/`, bridged in `src/preload/`. Use the `ipc-contract` skill.
- Register handlers with `handleTrusted` (`src/main/ipc/trusted-ipc.ts`); lint rejects any other `ipcMain` / `webContents.ipc` access. It rejects calls from frames other than the app's own page and hands the handler `unknown` arguments, which main must validate: the renderer is untrusted.
- The window never navigates or opens new windows. External links need an explicit IPC capability that validates the URL before `shell.openExternal`.
- Keep the main process responsive: no sync fs/child_process calls on hot paths.

# Repo Rules

- `main` is always releasable. Never break CI; if it's broken, fixing it comes first.
- **Testing policy.** Prefer integration and real Electron E2E tests. Add unit tests only for a specific, meaningful behavior (pure logic with real inputs). Do not introduce mocks, stubs, spies standing in for collaborators, `vi.stubGlobal` or fake implementations without explicit user authorization. A test must fail when its change is reverted. Read [test anti-patterns](docs/agents/test-antipatterns.md) and use the `testing` skill.
- Focused tests (`.only`) fail the run in both Vitest and Playwright; don't commit them.
- New dependencies: prefer what's already installed. pnpm refuses versions younger than 3 days (`minimumReleaseAge`); don't bypass it.

# Electron UI Validation

- Launch the app with `APP_BACKGROUND_LAUNCH=1`: the window stays hidden and never takes focus.
- Never call `show()`, `focus()`, `moveTop()`, `app.focus()` or anything that activates a window in test or agent-launched runs.
- Verify rendered UI with Playwright against the hidden window (screenshots work hidden). Use the `electron-ui-validation` skill. Don't use computer-use / desktop screenshots.
- Screenshots saved by E2E and `capture.mjs` are visual evidence for a human or agent to inspect, not regression tests: nothing compares them to a baseline.
- Rebuild (`pnpm build`) before launching the built app; `out/` may be stale.

# Code Style

- **Reuse before reimplementing.** Search for existing logic and extend it rather than writing a parallel version.
- **Naming.** No `utils`, `helpers`, `common`, `misc` files or folders. Name files after the domain concept they hold (`window-launch-mode.ts`, `app-info-ipc.ts`). Files are kebab-case; React component files are PascalCase.
- **Comments.** Only when code can't say it. One line, explaining why, not how.
- TypeScript is strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). No `any`, no non-null `!`, no `@ts-ignore`. Use `type`, not `interface`.
- Named exports only (configs excepted).
- UI: Tailwind utilities with the colour roles listed in `src/renderer/src/assets/main.css` (`bg-background`, `bg-island`, `text-muted-foreground`, `bg-primary`, ...); their values come from the active app theme in `src/renderer/src/assets/themes/` (default Islands Dark). Never use raw colours or Tailwind palette colours (`blue-500`) in components; add a role to every theme instead. shadcn primitives live in `src/renderer/src/components/ui/` (add more with `pnpm dlx shadcn@latest add <name>`, then change its `import { cn } from "cn"` to `@/lib/class-names` and `pnpm remove cn` (an upstream registry quirk: it imports and installs an unrelated `cn` package; `pnpm knip` flags it), and run `pnpm format`). Don't invent ad-hoc colors.

# First-Class Concerns

Every change considers:

1. **Cross-platform (macOS, Linux, Windows).** Guard platform-specific behavior at runtime (`process.platform`), build paths with `node:path`, never hardcode separators, shells or shortcuts. Use `CommandOrControl` for accelerators.
2. **Security.** Untrusted renderer, no remote code, no `shell.openExternal` on unvalidated URLs, strict CSP in `index.html`.
