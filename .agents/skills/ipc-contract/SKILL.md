---
name: ipc-contract
description: 'Load before adding or changing anything the renderer asks the main process to do (IPC channels, window.desktop API, preload bridge), or before moving logic across the main/preload/renderer boundary.'
---

# IPC contract

The renderer is an untrusted, sandboxed web page. Its only door to main is `window.desktop`, typed by `DesktopApi` in `src/shared/desktop-api.ts`. Follow the existing `getAppInfo` capability as the reference implementation.

## Adding a capability

1. **Contract (`src/shared/`)**: add the channel to `IPC_CHANNELS` and the method to `DesktopApi` with explicit request/response types. Data must be structured-clone safe: plain objects, arrays, primitives, Date, no functions or class instances. When a domain grows, give it its own `src/shared/<domain>-api.ts` and compose it into `DesktopApi`.
2. **Main (`src/main/ipc/<domain>-ipc.ts`)**: export `register<Domain>Ipc()` using `ipcMain.handle`, and call it from `src/main/index.ts` before the window is created. Validate every argument at runtime; types don't exist at the boundary. Keep handlers thin and put real logic in a named module under `src/main/<domain>/` so it's unit-testable without Electron.
3. **Preload (`src/preload/index.ts`)**: add one line mapping the method to `ipcRenderer.invoke(channel, ...args)`. No logic, no Node APIs, and never expose `ipcRenderer` itself or a generic "invoke any channel" function.
4. **Renderer**: call `window.desktop.<method>()` from a zustand store action (`src/renderer/src/state/`) or a hook, not inline in many components.

Main → renderer pushes (events): add a `subscribe<Thing>(callback) => unsubscribe` method to `DesktopApi`, implemented in preload with `ipcRenderer.on` + `removeListener`, and sent from main with `webContents.send`. Strip the `IpcRendererEvent` before calling the callback.

## Testing

- Pure logic behind a handler gets a unit test at the module that owns it (`src/main/<domain>/*.test.ts`).
- The end-to-end wire (renderer → preload → main → renderer) is proven once per user-visible flow in `tests/e2e/`. Don't unit-test the preload mapping or re-assert channel names.

## Checklist

- [ ] Contract types in `src/shared` and no Electron/Node/React imports there (lint enforces this).
- [ ] Inputs validated in main, errors returned as typed results or thrown with clear messages.
- [ ] No new `webPreferences` loosening, no remote URLs loaded.
- [ ] `pnpm check` and `pnpm test:e2e` pass.
