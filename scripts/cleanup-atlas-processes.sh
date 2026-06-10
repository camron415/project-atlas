#!/usr/bin/env bash
# Kill duplicate Atlas dev processes — keep at most one server on :8787.
set -euo pipefail

echo "Atlas process cleanup"

# Keep the PID actually bound to 8787 (if any).
KEEP_PID="$(lsof -ti:8787 2>/dev/null | head -1 || true)"
if [[ -n "${KEEP_PID}" ]]; then
  echo "  Keeping server PID ${KEEP_PID} (port 8787)"
else
  echo "  No server on port 8787"
fi

# Stop stale tsx watch / server children (not the live listener).
while read -r pid; do
  [[ -z "${pid}" ]] && continue
  if [[ -n "${KEEP_PID}" && "${pid}" == "${KEEP_PID}" ]]; then continue; fi
  # Don't kill the parent watch process if it owns the live server child.
  if pgrep -P "${pid}" 2>/dev/null | grep -q .; then
    child="$(pgrep -P "${pid}" | head -1)"
    if [[ -n "${KEEP_PID}" && "${child}" == "${KEEP_PID}" ]]; then continue; fi
  fi
  kill "${pid}" 2>/dev/null || true
done < <(pgrep -f "tsx watch src/index.ts" 2>/dev/null || true)

# Release builds don't need Metro — stop stray bundlers.
if lsof -ti:8081 >/dev/null 2>&1; then
  echo "  Stopping Metro on :8081 (not needed for release builds)"
  lsof -ti:8081 | xargs kill -9 2>/dev/null || true
fi

# Stale expo run:ios installers from old builds.
pkill -f "expo run:ios --device" 2>/dev/null || true

sleep 1
COUNT="$(lsof -ti:8787 2>/dev/null | wc -l | tr -d ' ')"
echo "  Servers on :8787: ${COUNT}"
echo "Done."
