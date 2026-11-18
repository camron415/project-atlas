# Tonight checklist — Phone standup ready for tomorrow morning

Do these **in order**. When a step says “paste to Cursor,” put the values in chat and I’ll wire `.env` + restart.

---

## PART A — Credentials I need from you (do this first)

### A1. Management API key (Collections upload — Mac → xAI)

1. Open [console.x.ai](https://console.x.ai) → sign in
2. Go to **Settings → Management Keys**  
   Direct path often: [console.x.ai/team/default/settings/management-keys](https://console.x.ai/team/default/settings/management-keys)
3. **Create Management Key**
4. Enable permissions:
   - **AddFileToCollection** (required)
   - Under Collections: list / get / add / **remove** documents (so we can replace the daily brief)
5. **Copy the key once** (you won’t see it again)

### A2. Collection ID

1. Open Voice Agent Builder → your **Atlas** agent → **Knowledge / Collections**
2. Open the collection that already has your docs
3. Copy the **Collection ID** (looks like `collection_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)

### A3. Paste into this chat exactly like:

```
XAI_MANAGEMENT_API_KEY=xai-mgmt-...
XAI_PHONE_COLLECTION_ID=collection_...
```

I’ll set `ATLAS_PHONE_COLLECTION_SYNC=1`, restart the server, and run a test upload of `PHONE-MORNING-BRIEF.md`.

---

## PART B — Update the phone agent (you in the console)

### B1. Replace instructions

1. Open the file (already on disk):  
   `server/data/phone-agent-knowledge/00-ATLAS-PHONE-AGENT.md`
2. Select all → copy
3. Voice Agent Builder → Atlas → **Instructions / System prompt** → paste (replace old)
4. **Do not Publish yet** if you’re still adding tools (Part D). If tools wait until tomorrow, Publish after B2.

### B2. Tools in the agent

Confirm these are ON:
- **Collections / file_search** (your knowledge collection attached)
- **Web search**

### B3. Publish

Click **Publish** so the phone number uses the new instructions.

---

## PART C — Manual Collection upload (only if Part A isn’t done tonight)

If you **don’t** get me the management key + collection ID tonight, upload these **manually** into the Collection (replace if same name exists):

**Must upload tonight:**
1. `PHONE-MORNING-BRIEF.md`  
   Path: `server/data/phone-agent-knowledge/PHONE-MORNING-BRIEF.md`
2. `00-ATLAS-PHONE-AGENT.md`  
   Path: `server/data/phone-agent-knowledge/00-ATLAS-PHONE-AGENT.md`

**Already in Collection from before (skip unless missing):**
- `01-camron/*` (MY_STORY, RESUME, etc.)
- `02-atlas/*`, `03-vocallearn/*`, `04-career/*`
- Older status files

If Part A succeeds, **skip manual upload** — Mac will push the daily brief automatically after 6:00 runs.

---

## PART D — Reverse path (call → Mac) — needed for no copy-paste

Managers write **to** the Collection. After standup we need Atlas to write **back** to the Mac (decisions, applied jobs, summary).

That requires xAI’s servers to reach your Mac over HTTPS.

### D1. Turn on Tailscale Funnel (on the Mac — I can run this with your OK)

```bash
tailscale funnel --bg 8787
```

You’ll get a public HTTPS URL like:  
`https://macbook-air-de-camron.tail5f7dec.ts.net/`

### D2. Agent tools to add in Voice Agent Builder

Add **HTTP / API / custom tools** (wording varies) pointing at Funnel + Bearer token.

**Shared header for all:**
```
Authorization: Bearer 6807085e083478cf21933852993fae38
```
(That’s `ATLAS_AGENT_TOKEN` — already in server `.env`. Rotate later if you want.)

| Tool name | Method | URL path | Body (JSON) |
|---|---|---|---|
| `search_context` | POST | `/agent/search_context` | `{ "query": "...", "limit": 8 }` |
| `mark_applied` | POST | `/agent/mark_applied` | `{ "company": "...", "role": "..." }` |
| `write_standup_decisions` | POST | `/agent/write_standup_decisions` | `{ "summary": "...", "decisions": [{ "project": "vocallearn\|career\|atlas", "text": "..." }] }` |
| `save_call_summary` | POST | `/agent/save_call_summary` | `{ "project": "atlas", "title": "Phone standup", "summary": "...", "action_items": ["..."] }` |

Full URL example:  
`https://<your-funnel-host>/agent/mark_applied`

### D3. Instruct the agent when to call tools

Already partly in `00-ATLAS-PHONE-AGENT.md`. After tools are added, append:

> At end of morning brief: call `write_standup_decisions` with approvals; if Camron applied to a job call `mark_applied`; call `save_call_summary` once with a short summary. Then end the call.

### D4. If Funnel/tools aren’t ready tonight

Tomorrow still works for the **inbound** brief (Collections). After the call you temporarily:
```bash
cd server && npm run mark-applied -- "Company" --role "Title"
```
and/or paste decisions into chat for me to save — until D1–D3 are done.

---

## PART E — Mac overnight (verify once)

1. Mac plugged in, awake (or prevent sleep overnight)
2. Atlas server running (`npm run dev` in `server/` — already up)
3. Schedulers should show: morning **5:50**, managers **6:00** (vocallearn+career), phone-brief **6:20**
4. Check: `curl http://127.0.0.1:8787/health`

---

## PART F — Tomorrow morning test

1. Anytime after **~6:05**, call the Atlas number  
2. Say: **“morning brief”** or **“standup”**  
3. Keep to ~10 minutes  
4. At end: answer “did you apply?” if asked  
5. Confirm tools wrote files (if Part D done) or run `mark-applied` (if not)

---

## What to send me right now

Minimum for auto Collection upload:
```
XAI_MANAGEMENT_API_KEY=...
XAI_PHONE_COLLECTION_ID=...
```

Optional for reverse write-back tonight:
```
OK to enable Tailscale Funnel on 8787
```

I’ll then: write `.env`, enable sync, test upload, enable Funnel, give you the exact tool URLs to paste into the Builder.
