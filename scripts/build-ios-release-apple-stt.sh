#!/usr/bin/env bash
# Standalone release build using Apple on-device STT (VocalLearn-style).
# Same Realtime voice-out path; skips Grok STT proxy = lower latency + fewer xAI tokens.
set -euo pipefail

export EXPO_PUBLIC_XAI_STT=0
export EXPO_PUBLIC_REALTIME_UNIFIED=0
exec "$(dirname "$0")/build-ios-release.sh" "$@"
