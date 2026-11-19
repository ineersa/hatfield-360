---
name: electron-ui-validation
description: 'Load before verifying anything rendered or any main/preload/IPC change in the running Electron app: launching it hidden, screenshots, accessibility tree, console/main logs, live dev inspection over CDP.'
---

# Electron UI validation

Always launch with `APP_BACKGROUND_LAUNCH=1`. The window stays hidden and never takes focus. Screenshots still work. Never call `show()`/`focus()` and never use desktop screenshots or computer-use.

## One-shot capture of the built app (default)

```bash
pnpm build
node .agents/skills/electron-ui-validation/scripts/capture.mjs [--out test-results/x.png] [--click "Button text"]...
```

It prints the accessibility tree (roles, names, text) and main + renderer console output, including uncaught renderer errors, and saves a screenshot. `--click` takes exact visible text and repeats in order. Read the screenshot with the Read tool to check layout and visuals. The accessibility tree is the cheaper check for content and state.

With no display (SSH, CI, sandbox), prefix the command with `xvfb-run -a`. If the error is `The platform failed to initialize`, that's the cause.

## Live dev app (hot reload) over CDP

```bash
APP_BACKGROUND_LAUNCH=1 pnpm dev --remoteDebuggingPort 9333   # run in background
```

Attach with Playwright `chromium.connectOverCDP('http://127.0.0.1:9333')`. The first page of the first context is the renderer. Use this for iterating on UI without rebuilding. Stop it when done: kill the `pnpm dev` process group, then make sure no `electron` process from this checkout survives (`pgrep -f "$PWD/node_modules/.pnpm/electron"`).

## Proving behavior permanently

A behavior that must stay working gets a Playwright spec in `tests/e2e/` (see `app-launch.spec.ts` for the launch pattern), run with `pnpm test:e2e`. Assert through roles/labels/test ids, not CSS classes. One spec per user-visible flow; don't duplicate unit-level checks.

## Troubleshooting

- Stale UI: `out/` is from an older build; rerun `pnpm build`.
- `window.desktop` undefined: the preload failed to load. Check `[main:err]` output and that the preload is still a single CJS file in `out/preload/index.js` (sandboxed preloads can't load ESM or other modules).
- Blank page: look for `[renderer:error]` lines and CSP violations.
