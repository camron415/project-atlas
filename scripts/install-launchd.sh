#!/usr/bin/env bash
# Install Atlas server as a macOS LaunchAgent (runs on login, restarts on crash).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_SRC="${ROOT}/scripts/launchd/com.atlas.server.plist"
PLIST_DST="${HOME}/Library/LaunchAgents/com.atlas.server.plist"
SERVER_SH="${ROOT}/scripts/atlas-server.sh"
NODE_BIN="$(/usr/bin/readlink -f /opt/homebrew/opt/node@22/bin/node 2>/dev/null || echo /opt/homebrew/opt/node@22/bin/node)"

chmod +x "${SERVER_SH}"

mkdir -p "${ROOT}/server/data" "${HOME}/Library/Logs" "${HOME}/Library/Application Support/Atlas"

sed -e "s|REPO_ROOT|${ROOT}|g" -e "s|USER_HOME|${HOME}|g" -e "s|USER_NAME|${USER}|g" -e "s|NODE_BIN|${NODE_BIN}|g" "${PLIST_SRC}" > "${PLIST_DST}"

launchctl bootout "gui/$(id -u)/com.atlas.server" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "${PLIST_DST}"
launchctl enable "gui/$(id -u)/com.atlas.server"
launchctl kickstart -k "gui/$(id -u)/com.atlas.server"

echo "Installed ${PLIST_DST}"
echo "Logs: ${HOME}/Library/Logs/com.atlas.server.stdout.log"
echo "Health: curl http://127.0.0.1:8787/health"
echo "Node binary (add to Full Disk Access if it hangs): ${NODE_BIN}"
echo ""
echo "Uninstall: launchctl bootout gui/$(id -u)/com.atlas.server && rm ${PLIST_DST}"
