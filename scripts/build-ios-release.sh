#!/usr/bin/env bash
# Build a standalone Atlas iOS app (embedded JS bundle — no Metro on launch).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TS_IP="${ATLAS_TAILSCALE_IP:-$(/opt/homebrew/bin/tailscale ip -4 2>/dev/null || true)}"
LAN_IP="${ATLAS_LAN_IP:-$(ipconfig getifaddr en0 2>/dev/null || echo "10.0.0.84")}"
TS_HOST="${ATLAS_TAILSCALE_HOST:-$(/opt/homebrew/bin/tailscale status --json 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin).get('Self',{}).get('DNSName','').rstrip('.'))" 2>/dev/null || true)}"
TAILNET="${ATLAS_TAILNET:-$(/opt/homebrew/bin/tailscale status --json 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin).get('MagicDNSSuffix',''))" 2>/dev/null || true)}"
DEVICE="${1:-00008130-00163C9A0061401C}"

if [[ -z "${TS_IP}" || -z "${TS_HOST}" ]]; then
  echo "Tailscale not ready. Is Tailscale running on this Mac?"
  exit 1
fi

# MagicDNS hostname first (iOS 17+ requires hostname, not raw IP for HTTP fetch).
export ATLAS_TAILSCALE_IP="${TS_IP}"
export ATLAS_TAILSCALE_HOST="${TS_HOST}"
export ATLAS_TAILNET="${TAILNET}"
export ATLAS_LAN_IP="${LAN_IP}"
export EXPO_PUBLIC_ATLAS_SERVER_URL="http://${TS_HOST}:8787,http://${LAN_IP}:8787,http://${TS_IP}:8787"
export EXPO_PUBLIC_ATLAS_DEBUG=0
export EXPO_PUBLIC_XAI_STT="${EXPO_PUBLIC_XAI_STT:-1}"
export EXPO_PUBLIC_REALTIME_UNIFIED="${EXPO_PUBLIC_REALTIME_UNIFIED:-1}"
export EXPO_PUBLIC_VOICE_V2="${EXPO_PUBLIC_VOICE_V2:-1}"
export EXPO_PUBLIC_WAKE_WORD=1
export EXPO_PUBLIC_WAKE_USE_JARVIS=1

ENV_FILE="${ROOT}/server/.env"
if [[ -f "${ENV_FILE}" ]]; then
  PICO_KEY="$(grep -E '^EXPO_PUBLIC_PICOVOICE_ACCESS_KEY=' "${ENV_FILE}" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
  if [[ -z "${PICO_KEY}" ]]; then
    PICO_KEY="$(grep -E '^PICOVOICE_ACCESS_KEY=' "${ENV_FILE}" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
  fi
  if [[ -n "${PICO_KEY}" ]]; then
    export EXPO_PUBLIC_PICOVOICE_ACCESS_KEY="${PICO_KEY}"
    echo "  Picovoice: key loaded from server/.env"
  else
    echo "  Picovoice: add PICOVOICE_ACCESS_KEY to server/.env for wake word"
  fi
  WAKE_PPN="$(grep -E '^EXPO_PUBLIC_WAKE_KEYWORD_PATH=' "${ENV_FILE}" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
  if [[ -n "${WAKE_PPN}" ]]; then
    export EXPO_PUBLIC_WAKE_KEYWORD_PATH="${WAKE_PPN}"
    export EXPO_PUBLIC_WAKE_USE_JARVIS=0
    echo "  Wake keyword: ${WAKE_PPN}"
  fi
fi

echo "Atlas release build (standalone — no Metro required)"
echo "  Voice: XAI_STT=${EXPO_PUBLIC_XAI_STT} REALTIME_UNIFIED=${EXPO_PUBLIC_REALTIME_UNIFIED} VOICE_V2=${EXPO_PUBLIC_VOICE_V2}"
echo "  MagicDNS (primary): http://${TS_HOST}:8787"
echo "  LAN fallback:       http://${LAN_IP}:8787"
echo "  Tailscale IP:       http://${TS_IP}:8787"
echo "  Device:             ${DEVICE}"
echo ""

cd "${ROOT}/apps/mobile"
bash "${ROOT}/scripts/patch-ios-ats.sh" "${ROOT}/apps/mobile/ios/Atlas/Info.plist"

exec npx expo run:ios --device "${DEVICE}" --configuration Release
