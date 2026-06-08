#!/usr/bin/env bash
# Patch Info.plist for iOS 17+ HTTP to Tailscale IPs and MagicDNS hostnames.
set -euo pipefail

PLIST="${1:-apps/mobile/ios/Atlas/Info.plist}"
TS_IP="${ATLAS_TAILSCALE_IP:-$(/opt/homebrew/bin/tailscale ip -4 2>/dev/null || true)}"
LAN_IP="${ATLAS_LAN_IP:-$(ipconfig getifaddr en0 2>/dev/null || echo "10.0.0.84")}"
TAILNET="${ATLAS_TAILNET:-$(/opt/homebrew/bin/tailscale status --json 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin).get('MagicDNSSuffix',''))" 2>/dev/null || true)}"
TS_HOST="${ATLAS_TAILSCALE_HOST:-$(/opt/homebrew/bin/tailscale status --json 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin).get('Self',{}).get('DNSName','').rstrip('.'))" 2>/dev/null || true)}"

if [[ ! -f "${PLIST}" ]]; then
  echo "Info.plist not found: ${PLIST}"
  exit 1
fi

patch_bool() {
  local key="$1"
  /usr/libexec/PlistBuddy -c "Add :NSAppTransportSecurity:${key} bool true" "${PLIST}" 2>/dev/null \
    || /usr/libexec/PlistBuddy -c "Set :NSAppTransportSecurity:${key} true" "${PLIST}" 2>/dev/null \
    || true
}

patch_exception() {
  local host="$1"
  [[ -z "${host}" ]] && return 0
  /usr/libexec/PlistBuddy -c "Add :NSAppTransportSecurity:NSExceptionDomains:${host} dict" "${PLIST}" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c "Add :NSAppTransportSecurity:NSExceptionDomains:${host}:NSExceptionAllowsInsecureHTTPLoads bool true" "${PLIST}" 2>/dev/null \
    || /usr/libexec/PlistBuddy -c "Set :NSAppTransportSecurity:NSExceptionDomains:${host}:NSExceptionAllowsInsecureHTTPLoads true" "${PLIST}" 2>/dev/null \
    || true
}

/usr/libexec/PlistBuddy -c "Add :NSAppTransportSecurity dict" "${PLIST}" 2>/dev/null || true
patch_bool "NSAllowsArbitraryLoads"
patch_bool "NSAllowsLocalNetworking"

/usr/libexec/PlistBuddy -c "Add :NSLocalNetworkUsageDescription string Atlas connects to your Mac on your home network." "${PLIST}" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Set :NSLocalNetworkUsageDescription Atlas connects to your Mac on your home network." "${PLIST}" 2>/dev/null \
  || true

/usr/libexec/PlistBuddy -c "Add :NSLocationWhenInUseUsageDescription string Atlas uses your location for weather and local search when you ask." "${PLIST}" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Set :NSLocationWhenInUseUsageDescription Atlas uses your location for weather and local search when you ask." "${PLIST}" 2>/dev/null \
  || true

/usr/libexec/PlistBuddy -c "Add :NSAppTransportSecurity:NSExceptionDomains dict" "${PLIST}" 2>/dev/null || true

patch_exception "${TS_IP}"
patch_exception "${LAN_IP}"
patch_exception "${TS_HOST}"
if [[ -n "${TAILNET}" ]]; then
  patch_exception "${TAILNET}"
  /usr/libexec/PlistBuddy -c "Add :NSAppTransportSecurity:NSExceptionDomains:${TAILNET}:NSIncludesSubdomains bool true" "${PLIST}" 2>/dev/null \
    || /usr/libexec/PlistBuddy -c "Set :NSAppTransportSecurity:NSExceptionDomains:${TAILNET}:NSIncludesSubdomains true" "${PLIST}" 2>/dev/null \
    || true
fi

echo "Patched ATS in ${PLIST}"
echo "  MagicDNS: ${TS_HOST}"
echo "  Tailscale: ${TS_IP}"
echo "  LAN:       ${LAN_IP}"
