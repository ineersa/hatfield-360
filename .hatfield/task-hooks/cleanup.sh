#!/usr/bin/env bash
set -euo pipefail
# Tasks own no resources beyond their worktree (node_modules and out/ live inside it and go with it).
# Only ever remove resources owned by this task; must be idempotent.
exit 0
