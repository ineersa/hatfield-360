# Hatfield 360

Electron desktop app: React renderer, Node main process, sandboxed preload bridge. Package manager is pnpm (version pinned in `package.json`), runtime Node 24 (`.nvmrc`).

# Commands

| Purpose                   | Command                                                                        |
| ------------------------- | ------------------------------------------------------------------------------ |
| Install                   | `pnpm install --frozen-lockfile`                                               |
| Run app (dev, hot reload) | `pnpm dev` (agents: `APP_BACKGROUND_LAUNCH=1 pnpm dev`, see Electron UI below) |
| Full gate                 | `pnpm check` (format, lint, typecheck, dead code, unit tests)                  |
| Unit tests                | `pnpm test [path]`                                                             |
| E2E (builds first)        | `pnpm test:e2e` (no display: `xvfb-run -a pnpm test:e2e`)                      |
| Format fix                | `pnpm format`                                                                  |
| Single tools              | `pnpm lint`, `pnpm typecheck`, `pnpm knip`                                     |

> [!IMPORTANT]
> Run `pnpm check` after your last edit and before every push. Run `pnpm test:e2e` when a change touches main, preload, IPC or anything rendered. Never `--no-verify`.

Watch CI with `gh run watch <run-id> --compact --exit-status` or `gh pr checks --watch`; don't poll.

# Architecture

```
src/main/      Electron main process (Node). Windows, IPC handlers, OS access.
src/preload/   contextBridge only. Exposes `window.desktop`; no logic.
src/renderer/  React UI (sandboxed web page). index.html + src/.
src/shared/    Types and constants used by every process. No electron, node:* or React imports.
config/        Tool configs (tsconfig per target, vitest, playwright, knip).
tests/e2e/     Playwright tests against the built Electron app.
```

Process boundary rules (enforced by lint where possible):

- Windows keep `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`. Don't loosen them.
- The renderer never imports `electron`, `node:*`, or anything from `src/main` / `src/preload`. It talks to main only through `window.desktop`.
- Every IPC capability is declared once in `src/shared` (channel name + request/response types in `DesktopApi`), handled in `src/main/ipc/`, bridged in `src/preload/`. Use the `ipc-contract` skill.
- Main validates any input arriving over IPC; the renderer is untrusted.
- Keep the main process responsive: no sync fs/child_process calls on hot paths.

# Repo Rules

- `main` is always releasable. Never break CI; if it's broken, fixing it comes first.
- **Do not add tests by default.** Add one only when it fails if your change is reverted, hardcodes its expected values, and runs at the single layer that owns the behavior. Read [test anti-patterns](docs/agents/test-antipatterns.md) and use the `testing` skill.
- New dependencies: prefer what's already installed. pnpm refuses versions younger than 3 days (`minimumReleaseAge`); don't bypass it.

# Electron UI Validation

- Launch the app with `APP_BACKGROUND_LAUNCH=1`: the window stays hidden and never takes focus.
- Never call `show()`, `focus()`, `moveTop()`, `app.focus()` or anything that activates a window in test or agent-launched runs.
- Verify rendered UI with Playwright against the hidden window (screenshots work hidden). Use the `electron-ui-validation` skill. Don't use computer-use / desktop screenshots.
- Rebuild (`pnpm build`) before launching the built app; `out/` may be stale.

# Code Style

- **Reuse before reimplementing.** Search for existing logic and extend it rather than writing a parallel version.
- **Naming.** No `utils`, `helpers`, `common`, `misc` files or folders. Name files after the domain concept they hold (`window-launch-mode.ts`, `app-info-ipc.ts`). Files are kebab-case; React component files are PascalCase.
- **Comments.** Only when code can't say it. One line, explaining why, not how.
- TypeScript is strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). No `any`, no non-null `!`, no `@ts-ignore`. Use `type`, not `interface`.
- Named exports only (configs excepted).
- UI: Tailwind utilities with the color tokens in `src/renderer/src/assets/main.css`; shadcn primitives live in `src/renderer/src/components/ui/` (add more with `pnpm dlx shadcn@latest add <name>`). Don't invent ad-hoc colors.

# First-Class Concerns

Every change considers:

1. **Cross-platform (macOS, Linux, Windows).** Guard platform-specific behavior at runtime (`process.platform`), build paths with `node:path`, never hardcode separators, shells or shortcuts. Use `CommandOrControl` for accelerators.
2. **Security.** Untrusted renderer, no remote code, no `shell.openExternal` on unvalidated URLs, strict CSP in `index.html`.
