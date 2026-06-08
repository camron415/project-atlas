#!/usr/bin/env bash
# Start Metro so the iPhone dev client can load JS over Tailscale (cellular or away).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TS_IP="${ATLAS_TAILSCALE_IP:-$(/opt/homebrew/bin/tailscale ip -4 2>/dev/null || true)}"

if [[ -z "${TS_IP}" ]]; then
  echo "Tailscale IP not found. Is Tailscale running on this Mac?"
  exit 1
fi

export REACT_NATIVE_PACKAGER_HOSTNAME="${TS_IP}"

echo "Metro packager hostname: ${TS_IP}:8081"
echo "Atlas server (API):      ${TS_IP}:8787"
echo ""
echo "On iPhone (Tailscale VPN on), open once if the app is blank on cellular:"
echo "  atlas://expo-development-client/?url=http://${TS_IP}:8081"
echo ""

cd "${ROOT}/apps/mobile"
exec npx expo start --dev-client -c --host lan
