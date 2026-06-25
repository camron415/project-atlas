#!/usr/bin/env bash
# Run Atlas morning inbox brief (for launchd/cron). Requires Node 22 + server deps.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"

cd "${ROOT}/server"
npm run morning-brief -- "$@"
