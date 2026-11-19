#!/usr/bin/env bash
set -euo pipefail
: "${HATFIELD_TASK_WORKTREE:?}"
cd -- "$HATFIELD_TASK_WORKTREE"
pnpm install --frozen-lockfile
# Electron downloads its binary lazily (cached in ~/.cache/electron); fetch it now so E2E runs offline.
node -e "require('electron')" >/dev/null
