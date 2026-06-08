# Atlas remote access (Tailscale)

## Recommended: standalone release build

Use a **release build** for Atlas on your iPhone when you want it to work **anywhere** (cellular, away from home) without Metro or a dev server.

Release builds embed the JavaScript bundle in the app. At runtime you only need:

| Requirement | Details |
|-------------|---------|
| **Tailscale VPN** | On your iPhone (status bar VPN badge) |
| **Mac awake** | With Atlas server running |
| **Port 8787** | `cd server && npm run dev` |

No Metro (8081). No deep links. No blank screen on cellular.

### Build and install (USB, one time)

```bash
./scripts/build-ios-release.sh
```

Or from `apps/mobile`: `npm run ios:release`

The script bakes in both LAN and Tailscale server URLs; the app probes in parallel and uses whichever responds first.

### After install

1. **At home (WiFi):** Works with or without Tailscale — LAN is usually fastest.
2. **Away (cellular):** Turn **Tailscale VPN on**, ensure Mac has `npm run dev` in `server/`, open Atlas.

---

## Dev builds (Metro required)

Debug/dev installs load JavaScript from **Metro** on every launch. Use these only while actively developing UI/JS.

| Service | Port | Purpose |
|---------|------|---------|
| **Metro** | 8081 | Loads JS (dev only) |
| **Atlas server** | 8787 | API, TTS, context |

```bash
# Terminal 1
cd server && npm run dev

# Terminal 2 (remote / cellular dev)
./scripts/start-mobile-remote.sh
```

Dev rebuild with Tailscale Metro host: `./scripts/rebuild-ios-remote.sh`

If the dev app is blank on cellular, open once in Safari (Tailscale on):

```
atlas://expo-development-client/?url=http://100.127.118.18:8081
```

---

## Verify connectivity

```bash
tailscale ip -4
curl http://100.127.118.18:8787/health
```

On iPhone (cellular, Tailscale on): Atlas header should show **Connected** with the resolved server IP.

## Env (`apps/mobile/.env`)

Used for **dev** builds and Metro. Release builds set URLs in `build-ios-release.sh`.

```bash
EXPO_PUBLIC_ATLAS_SERVER_URL=http://10.0.0.84:8787,http://100.127.118.18:8787
REACT_NATIVE_PACKAGER_HOSTNAME=100.127.118.18
```

## EAS cloud builds (optional)

For installs without USB / Xcode:

```bash
cd apps/mobile
npx eas-cli login
npx eas init
# Set EXPO_PUBLIC_ATLAS_SERVER_URL in EAS env or eas.json before building
npx eas build --profile preview --platform ios
```

Install the resulting `.ipa` via the EAS link or Apple internal distribution.
