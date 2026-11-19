#!/usr/bin/env bash
set -euo pipefail
# Hatfield sets cwd to the task worktree at review, and the merged primary at completion.
# Placeholder: fails until the project's real checks (lint/static analysis/tests) are wired in.
printf 'validate.sh: no project checks configured yet; edit .hatfield/task-hooks/validate.sh\n' >&2
exit 1
