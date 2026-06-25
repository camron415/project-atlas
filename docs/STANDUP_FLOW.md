# Daily standup — flow & script

**Owner:** Camron · **Moderator:** Atlas Chief · **Time:** 8:30 AM local (configurable)  
**Duration target:** ~15 minutes (VocalLearn-only at first; expand as managers ship)  
**Device:** iPhone or Mac — chief voice via economy path unless standup mode adds segments later

---

## Design principles

1. **Turn-based** — not simultaneous multi-agent chat (too hard to transcribe, attribute, and moderate).
2. **Structured first** — fixed segments per project; more free-form debate in later phases.
3. **Prep vs live** — markdown prep files before 8:30; live session is the product.
4. **Chief challenges** — devil's advocate / second opinion is **chief's job in v1** (same xAI stack, different prompt hat).
5. **Camron decides** — chief synthesizes; owner approves S2/S3 items.
6. **Skip quiet departments** — managers set `standup: skip` in prep; chief does not call them.

Inspired by real exec standups: **timeboxed**, **decisions captured**, **no problem-solving rabbit holes** in-room (park → inbox).

---

## Schedule (target)

| Time | What |
|------|------|
| **~8:00** | Atlas morning rollup prep (cross-project chief doc) |
| **~8:10** | VocalLearn manager prep → `vocalLearn/inbox/YYYY-MM-DD-standup-prep.md` |
| **~8:15** | Career / Atlas prep (when enabled; may skip) |
| **~8:25** | Chief compiles `atlas/inbox/YYYY-MM-DD-standup-agenda.md` |
| **8:30** | **Live standup** (notification Wave 2: “Standup ready”) |
| **After** | `atlas/inbox/YYYY-MM-DD-standup-decisions.md` + auto-queue S0/S1 |

Env (planned):

```bash
ATLAS_STANDUP_HOUR=8
ATLAS_STANDUP_MINUTE=30
ATLAS_STANDUP_PREP_MINUTE=10   # manager prep offset
```

Legacy `ATLAS_MORNING_BRIEF_*` and `ATLAS_MANAGER_*` roll into this model over time.

---

## Live standup structure

### Opening (chief — ~1 min)

> Good morning, sir. Standup for [date]. [N] departments reporting; [M] skipped. VocalLearn is priority one today.

### Per project (VocalLearn first) — ~8–10 min when active

**Four-turn debate** per department, then Camron input:

| Turn | Speaker | Role |
|------|---------|------|
| **1** | Manager | Read prep: progress, roadmap IDs, concerns, proposed today, **decisions needed** |
| **2** | Chief | Devil's advocate / alternative view: risks, scope, budget, blind spots |
| **3** | Manager | Short follow-up: extra dig if needed, concede or reinforce with evidence |
| **4** | Chief | **Synthesis / ultimatum**: recommended path, what needs Camron's word |
| **—** | **Camron** | Decisions on numbered items; chief confirms approval window per item |

Chief prompts Camron explicitly:

> “Decision one: [summary]. Options A or B — approval for [3 days]?”

**Quiet project:** Manager prep contains `standup: skip` → chief says:

> “[Name] reports no material update; skipping.”

### Closing (chief — ~2 min)

> Summary: [3 bullets]. Decisions logged [count]. Auto tasks queued [count]. Standup closed.

Writes `standup-decisions.md` and queues S0/S1.

---

## Prep file template (managers)

```markdown
# Standup prep — VocalLearn
**Date:** YYYY-MM-DD · **Manager:** [Name]

standup: active | skip

## Since yesterday
- …

## Roadmap
- Phase: … · IDs: VL-R…

## Progress / in flight
- …

## Concerns
- …

## Proposed today (P / S)
1. … (P1 / S0)
2. …

## Decisions for Camron
1. … — options A/B — suggest approval: 3d

## Auto queue (S0/S1)
- …
```

---

## Agenda file (chief)

`atlas/inbox/YYYY-MM-DD-standup-agenda.md` — chief-only rollup: order of speakers, decision count estimate, skip list.

---

## Decisions file (chief)

`atlas/inbox/YYYY-MM-DD-standup-decisions.md`:

```markdown
# Standup decisions — YYYY-MM-DD

| ID | Project | Decision | Approval until | Owner |
|----|---------|----------|----------------|-------|
| D-2026-06-26-1 | vocallearn | … | 2026-06-29 | camron |

## Auto-queued
- [VL] task … (S0)
```

---

## v1 implementation scope (avoid creep)

| In v1 | Deferred |
|-------|----------|
| Turn-based script in chief prompts | Simultaneous multi-model room |
| xAI only; chief = devil's advocate | Claude/Gemini managers |
| Text prep files + voice standup | Distinct TTS per manager |
| VocalLearn manager only in live loop | Full Career daily debate |
| Rename concept to **standup** in docs | Rename all cron env vars (incremental) |

---

## Real board-meeting practices we adopt

- **Pre-reads** — prep files before meeting (managers).
- **Timebox** — 15 min; chief cuts tangents (“park in inbox”).
- **Decision log** — written outcomes, not vibes.
- **No status theater** — skip when nothing changed.
- **One moderator** — chief owns floor; Camron speaks when called.
- **Action items** — every decision links to tasks with P/S tags.

---

## Voice / economy path

Standup uses existing economy stack: Grok STT → chief/plan-turn → server TTS.  
Phase 2b: optional **standup mode** flag — longer turns, structured tool to read prep files.  
Do not enable per-turn Realtime until economy hybrid is revisited.
