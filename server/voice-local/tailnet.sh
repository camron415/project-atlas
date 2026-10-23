#!/bin/bash
# Share the voice server on this Mac's tailnet only. Never use `tailscale funnel`.
set -euo pipefail
TS="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
if [[ ! -x "$TS" ]]; then
  echo "Install Tailscale on this Mac first: https://tailscale.com/download/macos"
  exit 1
fi

if ! "$TS" status 2>&1 | grep -q '^100\.'; then
  echo "This Mac is logged out of Tailscale."
  echo "Log in from the Tailscale menu bar, then run this again."
  exit 1
fi

"$TS" serve --bg --yes 8791
echo
"$TS" serve status
echo
"$TS" status
