#!/usr/bin/env bash
# Run Atlas server with Node 22 and server/.env (for launchd / cron).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="/opt/homebrew/opt/node@22/bin:${PATH:-/usr/bin:/bin}"

ENV_FILE="${ROOT}/server/.env"
if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

cd "${ROOT}/server"
# Give launchd a beat after crash/restart so tsx's ESM loader doesn't hit EDEADLK.
sleep 2
ulimit -n 10240 2>/dev/null || true
exec node ./node_modules/tsx/dist/cli.mjs src/index.ts
