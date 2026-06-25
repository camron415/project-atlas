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

- `server/data/launchd-stdout.log`
- `server/data/launchd-stderr.log`

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
