import assert from "node:assert/strict";
import { extractPhoneSpeakLayer } from "./build.js";

const vlDump = `# Standup prep — VocalLearn
standup: active

## Since yesterday
- HEAD advanced to c0cc60e: recruiter README published
- Hardcoded Supabase test credentials removed (2d7acf9)

## Roadmap position
- Phase 1.75 active (per PHASE_1_75.md reference).

## Proposed today (P / S)
1. Open docs/PHASE_1_75.md and docs/ROADMAP.md — P1 — S1
2. Tag src/hooks/useSession.ts — P1 — S2

## Decisions for Camron
1. Confirm Phase 1.75 is the current active phase.

## Auto queue (S0/S1)
- None today

## Git snapshot
HEAD: c0cc60e
`;

const careerDump = `# Standup prep — Career
standup: active

## Current apply queue (Camron — source of truth)
- 1. **WGU** — Associate Learning Systems Engineer (submit today)
  https://www.linkedin.com/jobs/view/4449689401/
- 2. **ConsultNet / TEKsystems / Robert Half** — Junior FE / React pipeline

## Board pulse (speak)
- Still prioritize (max 4 company+role) — NEVER include already-applied or closed listings:
  - WGU — Associate Learning Systems Engineer
  - FASHIONPHILE — Junior Software Engineer (Lehi)

## Today's apply candidate
- Company: Compass Insurance Advisors
- Role: Junior Frontend Developer
- Why fit (1-2 sentences): Local Category A match in Draper.
- Cover letter angle (2-3 bullets):
  - Highlight mentored seat
- Status: ready-to-prep

## Since yesterday
- Published recruiter-friendly README

## Proposed today (P / S)
1. Run npm run ingest — P1 — S0

## Decisions for Camron
1. Confirm Compass or skip.
`;

const vl = extractPhoneSpeakLayer(vlDump, "vocallearn");
assert.ok(!/useSession|PHASE_1_75\.md|c0cc60e/.test(vl), `VL still has path noise:\n${vl}`);
assert.ok(/Phase 1\.75/i.test(vl), "VL should keep phase decision");

const career = extractPhoneSpeakLayer(careerDump, "career");
assert.ok(/Compass Insurance Advisors/.test(career), "Career should lead with company");
assert.ok(/housekeeping/i.test(career), "Career npm tasks should be demoted");
assert.ok(!/Cover letter angle/i.test(career), "Cover letter bullets should be stripped");
assert.ok(/NEVER include/.test(career), `NEVER must survive sanitizer:\n${career}`);
assert.ok(/FASHIONPHILE/.test(career), `ALLCAPS company names must survive:\n${career}`);
assert.ok(/4449689401/.test(career), `LinkedIn job ids in URLs must survive:\n${career}`);

console.log("phone-brief extractPhoneSpeakLayer ok");
