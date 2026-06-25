#!/usr/bin/env bash
# Economy voice build: Grok STT + /voice/plan-turn (no Realtime API billing).
# Roll back to Realtime with: scripts/build-ios-release.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export EXPO_PUBLIC_VOICE_ECONOMY=1
export EXPO_PUBLIC_REALTIME_UNIFIED=0
export EXPO_PUBLIC_VOICE_V2=0
export EXPO_PUBLIC_XAI_STT=1

exec bash "${ROOT}/scripts/build-ios-release.sh" "$@"
