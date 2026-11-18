# Atlas server 24/7 (macOS LaunchAgent)

Run Atlas automatically when you log in and keep it alive across crashes.

## Prerequisites

- Node 22: `brew install node@22`
- `server/.env` configured (copy from `.env.example`)
- Tailscale running if iPhone needs remote access

## Install

```bash
chmod +x scripts/atlas-server.sh scripts/install-launchd.sh
./scripts/install-launchd.sh
```

Verify:

```bash
curl -s http://127.0.0.1:8787/health | python3 -m json.tool
curl -s http://127.0.0.1:8787/metrics/cost | python3 -m json.tool
```

## Logs

- `~/Library/Logs/com.atlas.server.stdout.log`
- `~/Library/Logs/com.atlas.server.stderr.log`

## Uninstall

```bash
launchctl bootout "gui/$(id -u)/com.atlas.server"
rm ~/Library/LaunchAgents/com.atlas.server.plist
```

## Manual run (debug)

```bash
./scripts/atlas-server.sh
```

## Morning brief on schedule

Ensure in `server/.env`:

```bash
ATLAS_MORNING_BRIEF=1
ATLAS_MORNING_BRIEF_PROJECTS=atlas
ATLAS_MONTHLY_BUDGET_USD=50
```

The server process must stay running (LaunchAgent handles this).

## Full Disk Access (required)

Atlas lives under `~/Documents`. A LaunchAgent cannot read that folder until Node is allowed:

1. System Settings → Privacy & Security → Full Disk Access
2. Add `/opt/homebrew/Cellar/node@22/22.22.3/bin/node` (or `/opt/homebrew/opt/node@22/bin/node`)
3. Toggle it on, then:

```bash
launchctl kickstart -k "gui/$(id -u)/com.atlas.server"
curl -s http://127.0.0.1:8787/health
```

Until this is granted, the job looks "running" but Node is stuck in `open()` waiting on TCC, so port 8787 never binds.

Do **not** also run `cd server && npm run dev` while the LaunchAgent is loaded — they fight over port 8787. To develop: `launchctl bootout "gui/$(id -u)/com.atlas.server"` first.

The LaunchAgent currently runs `tsx` against `server/src/index.ts`. After TypeScript changes, restart it:

```bash
launchctl kickstart -k "gui/$(id -u)/com.atlas.server"
```

`scripts/atlas-server.sh` will use `server/dist/index.js` if a build is present.
