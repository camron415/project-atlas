# Phone Voice Agent (Grok) — morning standup loop

## Daily automatic flow (Mac)

| Local time | What |
| --- | --- |
| **5:50** | Atlas morning brief (analyst) |
| **6:00** | Managers: **Sloane** + **Ellis** (Career runs ingest + apply report when `ATLAS_CAREER_INGEST=1`) |
| **6:00+** | Phone brief rollup → Collection |
| **6:20** | Backup phone-brief |

### Daily apply loop (Career)

1. Overnight: Greenhouse/Toast ingest + score → `career-dashboard/inbox/YYYY-MM-DD-apply-report.md`
2. Morning: skim **New today** / **Top local** (or hear board pulse on phone)
3. Confirm a role → generate packet:
   ```bash
   cd /Users/camrontrost/Documents/career-planning-roadmap/career-dashboard
   npm run packet:generate -- --company "Name" --role "Title" --url "https://..."
   # or from Atlas: cd server && npm run generate-packet -- --company "Name" --role "Title" --url "..."
   ```
4. Open `public/resume-exports/applications/<date>-.../` → upload `resume.pdf` + `cover-letter.pdf` at the apply URL
5. Mark applied: `cd atlas/server && npm run mark-applied -- "Company" --role "Title"`

**LinkedIn:** not scraped. Paste alerts into `career-dashboard/inbox/linkedin-haul.md`.

Call anytime after ~6:05 and say **morning brief** / **standup** (or career-only ask for the board pulse).

## Hands-off knowledge refresh

### End of every Cursor session (important)

Cursor chats are **not** visible to overnight managers or the phone agent unless they are dumped into inbox + Collection.

**Automatic:** user-level Cursor `sessionStart` / `sessionEnd` hooks (`scripts/cursor-hooks/`, install with `./scripts/cursor-hooks/install-user-hooks.sh`). Start injects `GET /agent/where_we_left_off`. End posts a stub if nothing was dumped in the last 15 minutes.

**Quality dump (prefer this):** after real work, from Atlas `server/`:

```bash
cd server
npm run refresh-phone-knowledge -- --note "One or two sentences: what changed and what's next"
```

Or `POST /agent/session_close` with the same note (Bearer `ATLAS_AGENT_TOKEN`).

That command:
1. Saves the note to `atlas/inbox/YYYY-MM-DD-cursor-session.md` (phone → `phone-call.md`, managers → `manager-run.md`)
2. Copies a Cursor dump into the matching project inbox when the workspace is VocalLearn or Career
3. Re-exports roadmaps/HANDOFF/inbox from Atlas + VocalLearn + Career
4. Writes `LIVE-REPO-STATUS.md` + fresh `WHERE_WE_LEFT_OFF.md` from live git
5. Rebuilds the phone speak brief
6. Uploads the **full** knowledge pack to your xAI Collection (when sync env is set)

`GET /health` includes `loop.lastCloseAt`, `loop.lastCollectionSyncAt`, and `loop.stale` (older than 36 hours).

Canonical phone instructions live in `docs/ATLAS_PHONE_AGENT_INSTRUCTIONS.md` (paste into Builder after big instruction changes, then Publish).

### Nightly (Mac awake)

**Best:** auto-upload daily brief to your xAI Collection.

1. Console → create **Management API Key** with Collections permissions ([docs](https://docs.x.ai/developers/files/collections/api))
2. Copy your Collection ID from the Voice Agent Builder knowledge page
3. In `server/.env`:
   ```bash
   ATLAS_PHONE_COLLECTION_SYNC=1
   XAI_MANAGEMENT_API_KEY=...
   XAI_PHONE_COLLECTION_ID=collection_...
   ```
4. Restart Atlas server

Managers read **live Mac disk** (git + roadmaps + inbox dumps). The Collection is what the **phone** sees.

**Phone → Mac:** call-end tools (`save_call_summary`, `write_standup_decisions`) write project inboxes **and** start a full loop dump (inbox note + pack export + Collection). Next Cursor session loads `GET /agent/where_we_left_off` (sessionStart hook) before assuming the phone call never happened.

**Managers → cache:** after the 6:00 Sloane/Ellis run, Atlas writes `manager-run.md` and refreshes the full knowledge pack (not only the 6:20 speak brief).

**Per-project Cursor sync:** paste `inbox/2026-08-14-cursor-project-sync-prompt-md.md` (or `docs/CURSOR_PROJECT_SYNC.md`) in each repo chat so July–now work lands in this same pack.

Manual export only (no Collection upload):
```bash
./scripts/export-phone-agent-knowledge.sh
```

## Applied roles (Career)

When you apply to a job, mark it so Ellis stops prioritizing it:

```bash
cd server && npm run mark-applied -- "Two Barrels" --role "Junior Software Engineer"
```

Or `POST /agent/mark_applied` with Bearer `ATLAS_AGENT_TOKEN` (needs Mac reachability).

On the call, Atlas should ask at the end: “Did you apply to anything?” — then you mark it on Mac (CLI until live tool is wired).

## Phone agent instructions

Paste `server/data/phone-agent-knowledge/00-ATLAS-PHONE-AGENT.md` into the agent system prompt, then **Publish**.

Includes: 10-minute moderator, keyword trigger, one-question discipline, applied-role closing item.

## Force a test run now

```bash
cd server
npm run manager -- vocallearn --force
npm run manager -- career --force
npm run phone-brief
npm run mark-applied -- --list
```

## Cost reminder

~10 min phone / day ≈ a few dollars per week voice. Managers use cheap text models (small vs voice).

### Pin Voice model to 1.0 ($0.05/min)

xAI moved `grok-voice-latest` to **Think Fast 2.0** ($0.08/min). Atlas app code already defaults to `grok-voice-think-fast-1.0`.

For the **phone agent in Voice Agent Builder** (where most of your call spend is):
1. Open the agent → Model / Voice settings
2. Explicitly select **`grok-voice-think-fast-1.0`** (not “latest”, not 2.0)
3. **Publish**

If Builder only shows a “latest” toggle, turn that off / pin 1.0. Otherwise usage will bill 2.0.
