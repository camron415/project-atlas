# Phase 1.75 — Analyst + Inbox (away-from-home planning)

**Goal:** Use Atlas voice away from home for **research and planning only** — no code
changes from the phone. Chief stays conversational; a separate **analyst** runs
read-only repo review; outcomes land in **inbox** files you pick up in Cursor later.

**Prerequisite (Phase 1.5 ✅):** Unified Realtime voice, persistent chat sessions,
Tailscale to Mac server.

---

## The workflow (how it should feel)

You described it correctly. Canonical flow:

```
1. REQUEST REVIEW
   You: "Atlas, run a fresh review of VocalLearn — architecture and risks."
   → Chief enqueues analyst job (one report per topic, not per sentence).

2. GATHER (analyst agent, Mac server)
   → Cached project reports + optional deep scan
   → Cheap/fast model produces structured brief (read-only, no git writes)

3. DISCUSS (chief + you, same chat session)
   → Chief has report in session context
   → You bounce ideas, priorities, tradeoffs
   → Live captions + saved chat turns (Phase 1.5 sessions)

4. PLAN
   → Agree game plan, next steps, what to defer

5. CLOSE — ONE inbox artifact (explicit, end of topic)
   You: "Summarize our session and save it to the atlas inbox."
   → Chief writes ONE markdown file: chat summary + analyst findings + action items
   → You do NOT say this after every smart line — only at close (or "log that" for a single idea)
```

| When | What happens |
| --- | --- |
| Mid-conversation | Chat auto-saves each turn; analyst report cached on server |
| "Refresh VocalLearn" | On-demand analyst/report refresh (may take 30–90s) |
| "Save to inbox" / end of session | Single inbox markdown per topic |
| Back at desk (Cursor) | Read `inbox/`, implement from notes |

**Not:** auto-inbox every Atlas reply. **Not:** analyst mixed into chief's system prompt 24/7.

---

## Architecture

```
┌─────────────┐     voice/text      ┌──────────────────┐
│  iPhone     │ ◄──────────────────►│  Chief (Jarvis)  │
│  Atlas app  │                     │  unified realtime │
└──────┬──────┘                     └────────┬─────────┘
       │                                     │
       │  chat sessions (SQLite)             │ tools
       ▼                                     ▼
┌──────────────────────────────────────────────────────┐
│  Mac Atlas server                                     │
│  • /sessions — chat persistence                       │
│  • /reports — cached project scans (24/7)             │
│  • /analyst/run — on-demand read-only review (NEW)    │
│  • /analyst/jobs/:id — status stream (NEW)            │
│  • /inbox — write markdown artifact (NEW)             │
└──────────────────────────────────────────────────────┘
       │
       ▼
  inbox/{project}/YYYY-MM-DD-slug.md  →  atlas | vocallearn | career repos
```

Chief announces analyst status in voice: *"Reviewing VocalLearn…"* → *"Report ready."*

---

## Implementation steps (build in order)

### Step 1 — Inbox file format + storage (small, high value)
- [x] `server/src/inbox/store.ts` — write markdown to configured repo paths
- [x] `POST /inbox` — `{ project, title, body, sessionId? }`
- [x] `POST /inbox/from-session` — export saved chat session to inbox markdown
- [x] `docs/inbox/README.md` — schema for Cursor handoff
- [x] Registry: map `vocallearn` | `career` | `atlas` → filesystem paths

**Test:** `curl POST /inbox` → file appears in repo.

### Step 2 — Analyst job runner (read-only)
- [x] `server/src/analyst/run.ts` — input: project slug, focus prompt
- [x] Uses existing `getLatestReports` + optional deep scan
- [x] Cheap model (`grok-4-fast-non-reasoning`) → structured markdown brief
- [x] Store result in `analyst_jobs` table + `data/analyst/`

**Test:** CLI `npm run analyst -- vocallearn "architecture risks"` → markdown out.

### Step 3 — Job status API (chief can poll / stream)
- [x] `POST /analyst/run` → `{ jobId }`
- [x] `GET /analyst/jobs/:id` → `{ status: queued|running|done|error, summary?, progress? }`
- [x] Chief tool: `request_analyst_review(project, focus)`

**Test:** Mobile shows thinking line; chief says status when polled.

### Step 4 — Chief tools wiring
- [x] Add tools to realtime proxy session
- [x] `request_analyst_review`, `get_analyst_status`, `write_inbox_summary`
- [x] Instructions: Jarvis confirmation, translator, plain-English briefs

**Test:** Voice: "Review atlas" → confirm → status updates → discuss → "save inbox".

### Step 5 — Mobile UX (minimal)
- [x] Show analyst status pill in footer ("Reviewing VocalLearn…")
- [ ] Optional: inbox list in ☰ drawer (read-only)

**Test:** Away-from-home session end-to-end.

### Step 6 — Session close template
- [x] `write_inbox_summary` merges: chat transcript + analyst brief + agreed actions
- [x] Filename: `inbox/{project}/YYYY-MM-DD-{slug}.md`

---

## Inbox markdown template

```markdown
# {title}
**Date:** {iso} · **Project:** {project} · **Session:** {sessionId}

## Summary
{chief narrative of conversation}

## Analyst findings
{analyst brief or "none this session"}

## Agreed next steps
- [ ] ...

## Open questions
- ...
```

---

## Budget / safety

- Analyst: on-demand only; default to **cached reports** (free)
- Deep scan: only when user asks "refresh" / "latest"
- Inbox write: one file per close — not per message
- No `git commit`, no file edits outside `inbox/` from phone path

---

## Exit criteria (Phase 1.75 done)

1. Away from home: voice plan session about 2+ projects
2. One analyst review completes with spoken status updates
3. One inbox file per session in correct repo
4. Cursor: read inbox → actionable next steps without re-explaining context

---

## After 1.75 → Phase 2

Managers, scheduled briefings, push notifications — inbox + analyst become inputs to
proactive loops, not replaced by them.
