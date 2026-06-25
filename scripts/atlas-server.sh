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
exec npx tsx src/index.ts
