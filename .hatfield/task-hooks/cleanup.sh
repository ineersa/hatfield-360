#!/usr/bin/env bash
set -euo pipefail
# No task-owned resources (containers, databases, caches) are provisioned yet.
# Only ever remove resources owned by this task; must be idempotent.
exit 0
