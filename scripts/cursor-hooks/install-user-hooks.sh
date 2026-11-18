#!/usr/bin/env bash
# Install Atlas loop hooks into ~/.cursor/hooks.json (all workspaces).
set -euo pipefail

ATLAS_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOOKS_DIR="${HOME}/.cursor"
HOOKS_FILE="${HOOKS_DIR}/hooks.json"
START="${ATLAS_ROOT}/scripts/cursor-hooks/session-start.py"
END="${ATLAS_ROOT}/scripts/cursor-hooks/session-end.py"

chmod +x "$START" "$END"
mkdir -p "$HOOKS_DIR"

python3 - "$HOOKS_FILE" "$START" "$END" <<'PY'
import json, os, sys

path, start, end = sys.argv[1], sys.argv[2], sys.argv[3]
existing = {"version": 1, "hooks": {}}
if os.path.exists(path):
    try:
        with open(path, encoding="utf-8") as fh:
            loaded = json.load(fh)
        if isinstance(loaded, dict):
            existing.update(loaded)
            existing.setdefault("hooks", {})
    except (json.JSONDecodeError, OSError):
        pass

hooks = existing.setdefault("hooks", {})

def upsert(event, command, timeout):
    entries = [e for e in hooks.get(event, []) if not str(e.get("command", "")).endswith("cursor-hooks/session-start.py") and not str(e.get("command", "")).endswith("cursor-hooks/session-end.py")]
    entries.append({"command": command, "timeout": timeout})
    hooks[event] = entries

upsert("sessionStart", start, 20)
upsert("sessionEnd", end, 120)
existing["version"] = 1
existing["hooks"] = hooks

with open(path, "w", encoding="utf-8") as fh:
    json.dump(existing, fh, indent=2)
    fh.write("\n")
print(path)
PY

echo "Installed Atlas loop hooks → ${HOOKS_FILE}"
echo "Restart Cursor or reload Hooks if they do not appear in Settings → Hooks."
