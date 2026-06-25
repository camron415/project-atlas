#!/usr/bin/env bash
# Tailscale setup for Atlas remote access (Mac server ↔ iPhone away from home).
# Run from the Atlas repo root. Requires your Mac admin password for the app install.

set -euo pipefail

ATLAS_PORT="${ATLAS_PORT:-8787}"
MOBILE_ENV="apps/mobile/.env"
SERVER_ENV="server/.env"

echo "=== Atlas Tailscale setup ==="
echo ""

if [[ ! -d /Applications/Tailscale.app ]]; then
  echo "Tailscale Mac app not found. Install it (requires password):"
  echo "  brew install --cask tailscale"
  echo ""
  echo "Or install 'Tailscale' from the Mac App Store, then re-run this script."
  echo ""
  if command -v brew >/dev/null 2>&1; then
    read -r -p "Install via Homebrew cask now? [y/N] " ans
    if [[ "${ans,,}" == "y" ]]; then
      brew install --cask tailscale
    else
      exit 1
    fi
  else
    exit 1
  fi
fi

echo "1. Open Tailscale and sign in (same account as your iPhone)."
open -a Tailscale 2>/dev/null || true
echo "   → Menu bar icon → Log in if needed."
echo ""

echo "2. Install Tailscale on your iPhone from the App Store and sign in with the SAME account."
echo "   Enable VPN when prompted (Tailscale uses a private mesh, not a public VPN service)."
echo ""

read -r -p "Press Enter once Tailscale is running on both Mac and iPhone…"

TS_IP=""
if command -v tailscale >/dev/null 2>&1; then
  TS_IP="$(tailscale ip -4 2>/dev/null || true)"
fi

if [[ -z "${TS_IP}" ]]; then
  echo "Could not read Tailscale IP. After login, run:"
  echo "  tailscale ip -4"
  read -r -p "Paste your Mac Tailscale IPv4 (100.x.x.x): " TS_IP
fi

if [[ ! "${TS_IP}" =~ ^100\. ]]; then
  echo "Warning: expected a 100.x.x.x Tailscale address, got: ${TS_IP}"
fi

ATLAS_URL="http://${TS_IP}:${ATLAS_PORT}"
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "10.0.0.84")"
LAN_URL="http://${LAN_IP}:${ATLAS_PORT}"
TS_HOST=""
TAILNET=""
if command -v tailscale >/dev/null 2>&1; then
  TS_HOST="$(tailscale status --json 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin).get('Self',{}).get('DNSName','').rstrip('.'))" 2>/dev/null || true)"
  TAILNET="$(tailscale status --json 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin).get('MagicDNSSuffix',''))" 2>/dev/null || true)"
fi
if [[ -n "${TS_HOST}" ]]; then
  MAGIC_URL="http://${TS_HOST}:${ATLAS_PORT}"
  ATLAS_URLS="${MAGIC_URL},${LAN_URL},${ATLAS_URL}"
else
  ATLAS_URLS="${ATLAS_URL},${LAN_URL}"
fi
echo ""
echo "3. Atlas server URLs: ${ATLAS_URLS}"

# Mobile client — LAN + Tailscale (auto-picks first that responds).
if [[ -f "${MOBILE_ENV}" ]]; then
  if grep -q '^EXPO_PUBLIC_ATLAS_SERVER_URL=' "${MOBILE_ENV}"; then
    sed -i '' "s|^EXPO_PUBLIC_ATLAS_SERVER_URL=.*|EXPO_PUBLIC_ATLAS_SERVER_URL=${ATLAS_URLS}|" "${MOBILE_ENV}"
  else
    echo "EXPO_PUBLIC_ATLAS_SERVER_URL=${ATLAS_URL}" >> "${MOBILE_ENV}"
  fi
  echo "   Updated ${MOBILE_ENV}"
else
  echo "EXPO_PUBLIC_ATLAS_SERVER_URL=${ATLAS_URLS}" > "${MOBILE_ENV}"
  echo "   Created ${MOBILE_ENV}"
fi

# Server — optional public URL for /health
if [[ -f "${SERVER_ENV}" ]]; then
  if grep -q '^ATLAS_TAILSCALE_IP=' "${SERVER_ENV}"; then
    sed -i '' "s|^ATLAS_TAILSCALE_IP=.*|ATLAS_TAILSCALE_IP=${TS_IP}|" "${SERVER_ENV}"
  else
    echo "ATLAS_TAILSCALE_IP=${TS_IP}" >> "${SERVER_ENV}"
  fi
  if grep -q '^ATLAS_PUBLIC_URL=' "${SERVER_ENV}"; then
    sed -i '' "s|^ATLAS_PUBLIC_URL=.*|ATLAS_PUBLIC_URL=${ATLAS_URL}|" "${SERVER_ENV}"
  fi
  echo "   Updated ${SERVER_ENV} (ATLAS_TAILSCALE_IP, ATLAS_PUBLIC_URL)"
fi

echo ""
echo "4. Verify (Mac must be awake, Atlas server running):"
echo "   curl ${ATLAS_URL}/health"
echo ""
echo "5. Restart Metro with a clean cache:"
echo "   cd apps/mobile && npx expo start --dev-client -c"
echo ""
echo "6. On iPhone: ensure Tailscale VPN is ON, then open Atlas dev client."
echo ""
curl -sf "${ATLAS_URL}/health" && echo "Health check OK." || echo "Health check failed — start server: cd server && npm run dev"
