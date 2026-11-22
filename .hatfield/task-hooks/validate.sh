#!/usr/bin/env bash
set -euo pipefail
# Hatfield sets cwd to the task worktree at review, and the merged primary checkout at completion.
pnpm install --frozen-lockfile
# On Linux the E2E tests get an X server of their own when xvfb is installed: Electron needs one
# without a display, and on the user's desktop the tests would share its clipboard.
if [[ "$(uname -s)" == Linux ]] && command -v xvfb-run >/dev/null; then
    # GLX can crash Xvfb when the host's NVIDIA and software rendering drivers conflict.
    exec xvfb-run -a --server-args='-screen 0 1280x1024x24 -extension GLX' pnpm verify
fi
exec pnpm verify
