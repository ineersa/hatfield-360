#!/usr/bin/env bash
set -euo pipefail
# Hatfield sets cwd to the task worktree at review, and the merged primary checkout at completion.
pnpm install --frozen-lockfile
pnpm check
if [[ -z "${DISPLAY:-}" && -z "${WAYLAND_DISPLAY:-}" ]]; then
    exec xvfb-run -a pnpm test:e2e
fi
exec pnpm test:e2e
