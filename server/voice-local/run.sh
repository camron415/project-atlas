#!/bin/bash
# Local Atlas voice loop. Models stay warm until this process stops.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
VENV="${ATLAS_VOICE_VENV:-$HOME/Library/Application Support/Atlas/voice-venv}"
PY="/opt/homebrew/bin/python3.12"

if [[ ! -x "$PY" ]]; then
  echo "Need Homebrew Python 3.12 at $PY"
  echo "Install: brew install python@3.12"
  exit 1
fi

if [[ ! -x "$VENV/bin/python" ]]; then
  mkdir -p "$(dirname "$VENV")"
  "$PY" -m venv "$VENV"
  "$VENV/bin/pip" install -U pip
  "$VENV/bin/pip" install -r "$ROOT/requirements.txt"
fi

exec "$VENV/bin/python" "$ROOT/app.py"
