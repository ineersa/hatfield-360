#!/usr/bin/env bash
set -euo pipefail
# Hatfield sets cwd to the task worktree at review, and the merged primary checkout at completion.
pnpm install --frozen-lockfile
# Electron needs an X server on Linux; macOS and Windows always have a window server.
if [[ "$(uname -s)" == Linux && -z "${DISPLAY:-}" && -z "${WAYLAND_DISPLAY:-}" ]]; then
    exec xvfb-run -a pnpm verify
fi
exec pnpm verify
