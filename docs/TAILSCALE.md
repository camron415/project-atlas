# Atlas remote access (Tailscale)

Use Tailscale so your iPhone reaches the Atlas server on your Mac **at home and away** — one private URL, no port forwarding.

## Quick setup

```bash
chmod +x scripts/setup-tailscale.sh
./scripts/setup-tailscale.sh
```

The script will:

1. Install/open the Tailscale Mac app (you sign in once)
2. Prompt you to install Tailscale on iPhone (App Store, same account)
3. Write your Mac’s Tailscale IP (`100.x.x.x`) into `apps/mobile/.env`
4. Verify `curl http://100.x.x.x:8787/health`

Then restart Metro:

```bash
cd apps/mobile && npx expo start --dev-client -c
```

## Manual steps

| Step | Action |
|------|--------|
| Mac | Install [Tailscale](https://tailscale.com/download) → sign in |
| iPhone | App Store → Tailscale → same account → enable VPN |
| IP | On Mac: `tailscale ip -4` → e.g. `100.64.0.1` |
| Mobile | `EXPO_PUBLIC_ATLAS_SERVER_URL=http://100.x.x.x:8787` in `apps/mobile/.env` |
| Server | Mac stays awake (already configured); `cd server && npm run dev` |

## Requirements

- Mac powered on with Atlas server running (`npm run dev` in `server/`)
- Tailscale VPN active on iPhone when away from home
- Same Tailscale account on both devices

## Notes

- Tailscale replaces the LAN IP (`10.0.0.84`) — works on WiFi **and** cellular
- Voice (xAI WebSocket) goes directly from phone → xAI; project context/refresh goes phone → Mac via Tailscale
- Optional: add `server/` to a `launchd` plist so Atlas starts on login
