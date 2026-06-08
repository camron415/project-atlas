#!/usr/bin/env bash
# Rebuild the iOS dev client with Tailscale as the default Metro host (required for cellular).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TS_IP="${ATLAS_TAILSCALE_IP:-$(/opt/homebrew/bin/tailscale ip -4 2>/dev/null || true)}"
DEVICE="${1:-00008130-00163C9A0061401C}"

if [[ -z "${TS_IP}" ]]; then
  echo "Tailscale IP not found. Is Tailscale running on this Mac?"
  exit 1
fi

export REACT_NATIVE_PACKAGER_HOSTNAME="${TS_IP}"
echo "Building dev client with Metro host ${TS_IP}:8081 …"

cd "${ROOT}/apps/mobile"
exec npx expo run:ios --device "${DEVICE}"
