#!/usr/bin/env bash
# Install Atlas server as a macOS LaunchAgent (runs on login, restarts on crash).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_SRC="${ROOT}/scripts/launchd/com.atlas.server.plist"
PLIST_DST="${HOME}/Library/LaunchAgents/com.atlas.server.plist"
SERVER_SH="${ROOT}/scripts/atlas-server.sh"

chmod +x "${SERVER_SH}"

mkdir -p "${ROOT}/server/data"

sed "s|REPO_ROOT|${ROOT}|g" "${PLIST_SRC}" > "${PLIST_DST}"

launchctl bootout "gui/$(id -u)/com.atlas.server" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "${PLIST_DST}"
launchctl enable "gui/$(id -u)/com.atlas.server"
launchctl kickstart -k "gui/$(id -u)/com.atlas.server"

echo "Installed ${PLIST_DST}"
echo "Logs: ${ROOT}/server/data/launchd-stdout.log"
echo "Health: curl http://127.0.0.1:8787/health"
echo ""
echo "Uninstall: launchctl bootout gui/$(id -u)/com.atlas.server && rm ${PLIST_DST}"
