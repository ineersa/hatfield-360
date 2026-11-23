# hatfield-360

Electron desktop app (React + TypeScript, built with electron-vite).

## Getting started

Requirements: Node 24 (`.nvmrc`) and Corepack (`corepack enable` provides the pinned pnpm). Linux E2E runs without a display also need `xvfb`.

```bash
pnpm install
pnpm dev          # run the app with hot reload
pnpm check        # format, lint, typecheck, dead code, unit tests
pnpm test:e2e     # build and drive the real app with Playwright (hidden window)
pnpm verify       # check + test:e2e: the complete gate the task hooks run
pnpm package      # build installers for the current OS into release/
```

Contributor and agent rules live in [AGENTS.md](AGENTS.md). Agent skills are in `.agents/skills/` (linked into `.claude/skills/`).

## Development workflow

- Tasks are GitHub issues tracked through the **Hatfield Status** issue field (task-workflow plugin / Hatfield extension). Config: `.hatfield/settings.yaml`; hooks: `.hatfield/task-hooks/` (setup installs deps, validate runs `pnpm verify`, under xvfb on headless Linux).
- Observational memory is served by the local Librarian (`http://127.0.0.1:8093/_mcp`), configured in `~/.hatfield/settings.yaml`.
- There is no PR CI; the validate hook is the gate. Releases: publish a GitHub release (or dispatch `.github/workflows/release.yml` with a ref) to check, package and smoke-test the app on Linux and macOS and upload the installers. macOS builds are unsigned for now.
